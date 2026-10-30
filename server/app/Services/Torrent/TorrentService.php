<?php

namespace App\Services\Torrent;

use App\Events\TorrentUpdated;
use App\Models\Folder;
use App\Models\StoredFile;
use App\Models\Torrent;
use App\Models\User;
use App\Services\StoredFileWriter;
use App\Services\TrashService;
use App\Support\StoragePath;
use App\Support\SyncHash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Встроенный торрент-клиент файлового менеджера: .torrent-файл,
 * загруженный в любую папку (веб, sync-десктоп, публичная ссылка),
 * порождает задачу Torrent. По folders.torrent_mode она либо сразу
 * качает все файлы (auto), либо ждёт выбора (manual →
 * awaiting_selection). Загрузку выполняет внешний движок
 * (TorrentEngine, aria2) в staging-каталоге диска «torrents» —
 * частичные данные не попадают в sync-дерево. По завершении файлы
 * переносятся в папку с именем торрента и регистрируются как обычные
 * StoredFile (конвертация и синхронизация работают дальше сами).
 */
class TorrentService
{
    public function __construct(
        public TorrentEngine $engine,
        public StoredFileWriter $writer,
    ) {}

    /**
     * Хук StoredFileWriter::register — вызывается на каждый созданный
     * файл. Ничего не делает для не-torrent файлов.
     */
    public function onFileRegistered(StoredFile $file): void
    {
        if (! self::isTorrentFile($file)) {
            return;
        }

        try {
            $raw = Storage::disk('public')->get($file->path);
            $meta = TorrentMeta::parse($raw);
        } catch (\Throwable $e) {
            $torrent = Torrent::create([
                'user_id' => $file->user_id,
                'folder_id' => $file->folder_id,
                'stored_file_id' => $file->id,
                'name' => $file->name,
                'status' => Torrent::STATUS_ERROR,
                'error' => 'Не удалось разобрать .torrent: '.$e->getMessage(),
            ]);
            $this->broadcast($torrent);

            return;
        }

        $torrent = Torrent::create([
            'user_id' => $file->user_id,
            'folder_id' => $file->folder_id,
            'stored_file_id' => $file->id,
            'info_hash' => $meta->infoHash,
            'name' => $meta->name,
            'status' => Torrent::STATUS_AWAITING_SELECTION,
            'files' => array_map(
                fn (array $f) => [...$f, 'selected' => true],
                $meta->files,
            ),
            'total_size' => $meta->totalSize,
        ]);

        if ($file->folder?->torrent_mode === 'manual') {
            $this->broadcast($torrent);

            return;
        }

        try {
            $this->start($torrent, null);
        } catch (\Throwable $e) {
            // start() уже проставил status=error — глотаем, чтобы не
            // ломать успешную загрузку самого .torrent-файла.
            report($e);
        }
    }

    public static function isTorrentFile(StoredFile $file): bool
    {
        return str_ends_with(strtolower($file->name), '.torrent')
            || $file->mime_type === 'application/x-bittorrent';
    }

    /**
     * Старт загрузки. $indexes — 0-based индексы файлов из
     * $torrent->files; null/пустой список — качать все.
     *
     * @param  list<int>|null  $indexes
     */
    public function start(Torrent $torrent, ?array $indexes = null): void
    {
        abort_if(
            in_array($torrent->status, [Torrent::STATUS_DOWNLOADING, Torrent::STATUS_COMPLETED], true),
            422,
            'Торрент уже качается или скачан.',
        );

        $file = $torrent->storedFile;
        abort_if($file === null || $file->trashed(), 422, '.torrent-файл удалён.');
        $raw = Storage::disk('public')->get($file->path);
        abort_if($raw === null, 422, 'Не удалось прочитать .torrent-файл.');

        // Выбор файлов: null → все; иначе помечаем selected в метаданных.
        $files = $torrent->files ?? [];
        $known = array_column($files, 'index');
        $select = $indexes === null || $indexes === []
            ? null
            : array_values(array_intersect($indexes, $known));
        if ($select !== null) {
            $files = array_map(
                fn (array $f) => [...$f, 'selected' => in_array($f['index'], $select, true)],
                $files,
            );
        }

        Storage::disk('torrents')->makeDirectory($this->stagingDir($torrent));

        try {
            $gid = $this->engine->addTorrent(
                $raw,
                rtrim((string) config('services.torrent.download_dir', '/downloads'), '/').'/'.$torrent->id,
                $select,
            );
        } catch (\Throwable $e) {
            $torrent->forceFill([
                'status' => Torrent::STATUS_ERROR,
                'error' => mb_substr($e->getMessage(), 0, 2000),
                'download_rate' => 0,
            ])->save();
            $this->broadcast($torrent);

            throw $e;
        }

        $torrent->forceFill([
            'gid' => $gid,
            'status' => Torrent::STATUS_DOWNLOADING,
            'files' => $files,
            'progress' => 0,
            'downloaded_size' => 0,
            'download_rate' => 0,
            'error' => null,
        ])->save();
        $this->broadcast($torrent);
    }

    public function pause(Torrent $torrent): void
    {
        abort_if($torrent->status !== Torrent::STATUS_DOWNLOADING, 422, 'Торрент не качается.');
        abort_if($torrent->gid === null, 422, 'Задача не запущена.');

        $this->engine->pause($torrent->gid);
        $torrent->forceFill([
            'status' => Torrent::STATUS_PAUSED,
            'download_rate' => 0,
        ])->save();
        $this->broadcast($torrent);
    }

    public function resume(Torrent $torrent): void
    {
        abort_if($torrent->status !== Torrent::STATUS_PAUSED, 422, 'Торрент не на паузе.');
        abort_if($torrent->gid === null, 422, 'Задача не запущена.');

        $this->engine->resume($torrent->gid);
        $torrent->forceFill(['status' => Torrent::STATUS_DOWNLOADING])->save();
        $this->broadcast($torrent);
    }

    /**
     * Опрос движка (вызывается поллером раз в ~2–3 сек): обновляет
     * прогресс/скорость, по complete — переносит файлы в файловый
     * менеджер. Ошибки движка и потерю задачи переводит в error.
     */
    public function poll(Torrent $torrent): void
    {
        if ($torrent->gid === null || $torrent->status !== Torrent::STATUS_DOWNLOADING) {
            return;
        }

        try {
            $st = $this->engine->status($torrent->gid);
        } catch (\Throwable $e) {
            $torrent->forceFill([
                'status' => Torrent::STATUS_ERROR,
                'error' => 'Задача потеряна движком: '.mb_substr($e->getMessage(), 0, 1900),
                'download_rate' => 0,
            ])->save();
            $this->broadcast($torrent);

            return;
        }

        $progress = $st['total'] > 0
            ? min(100, (int) ($st['completed'] * 100 / $st['total']))
            : 0;

        match ($st['status']) {
            'complete' => $this->finalize($torrent),
            'active' => $this->saveAndBroadcast($torrent, [
                'status' => Torrent::STATUS_DOWNLOADING,
                'progress' => $progress,
                'downloaded_size' => $st['completed'],
                'download_rate' => $st['rate'],
            ]),
            'paused' => $this->saveAndBroadcast($torrent, [
                'status' => Torrent::STATUS_PAUSED,
                'progress' => $progress,
                'downloaded_size' => $st['completed'],
                'download_rate' => 0,
            ]),
            default => $this->saveAndBroadcast($torrent, [
                'status' => Torrent::STATUS_ERROR,
                'error' => $st['error'] ?? 'Загрузка остановлена движком.',
                'downloaded_size' => $st['completed'],
                'download_rate' => 0,
            ]),
        };
    }

    /**
     * Завершение: перенос скачанного из staging в файловый менеджер —
     * папка с именем торрента рядом с .torrent-файлом (коллизия имён —
     * суффикс « (N)», внутри воспроизводится структура торрента),
     * каждый файл регистрируется StoredFileWriter'ом (конвертация и
     * sync-хэши — штатными путями).
     */
    public function finalize(Torrent $torrent): void
    {
        $disk = Storage::disk('torrents');
        $staging = $this->stagingDir($torrent);
        $user = $torrent->user;
        $parent = $torrent->folder;

        $result = Folder::create([
            'user_id' => $user->id,
            'parent_id' => $parent?->id,
            'name' => $this->uniqueFolderName($user->id, $parent?->id, $torrent->name),
            'default_ttl_days' => $parent?->default_ttl_days,
            'conversion_enabled' => $parent?->conversion_enabled ?? true,
        ]);

        $dirs = ['' => $result];
        foreach ($disk->allFiles($staging) as $path) {
            $rel = substr($path, strlen($staging) + 1);
            $relDir = str_contains($rel, '/') ? dirname($rel) : '';
            $target = $this->ensureDir($user, $result, $dirs, $relDir);

            $uuid = (string) Str::uuid();
            $extension = strtolower(pathinfo($rel, PATHINFO_EXTENSION) ?: 'bin');
            $dest = StoragePath::file($uuid, $extension);
            $mtime = $disk->lastModified($path);

            $stream = $disk->readStream($path);
            Storage::disk('public')->put($dest, $stream);
            if (is_resource($stream)) {
                fclose($stream);
            }

            $this->writer->register($user, $target, [
                'uuid' => $uuid,
                'name' => basename($rel),
                'filename' => "{$uuid}.{$extension}",
                'mime_type' => Storage::disk('public')->mimeType($dest),
                'size' => (int) Storage::disk('public')->size($dest),
                'path' => $dest,
                'mtime' => (int) $mtime,
            ], detectTorrents: false);
        }

        $gid = $torrent->gid;
        $torrent->forceFill([
            'status' => Torrent::STATUS_COMPLETED,
            'progress' => 100,
            'downloaded_size' => $torrent->total_size,
            'download_rate' => 0,
            'result_folder_id' => $result->id,
            'gid' => null,
        ])->save();

        if ($gid !== null) {
            $this->engine->purge($gid);
        }
        $disk->deleteDirectory($staging);

        // Создание result-папки само по себе меняет dir_hash родителя —
        // досчёт на случай пустого дерева загрузки (файлов не было).
        SyncHash::refreshFolderChain($parent, $user);
        $this->broadcast($torrent);
    }

    /**
     * Удаление задачи. with_data=false — уходит только запись Torrent
     * (result-папка и .torrent остаются); with_data=true — ещё и
     * result-папка с содержимым и сам .torrent-файл уходят в корзину.
     * Живая загрузка сначала снимается в движке, staging чистится.
     */
    public function destroy(Torrent $torrent, bool $withData): void
    {
        if ($torrent->gid !== null) {
            try {
                $this->engine->remove($torrent->gid);
            } catch (\Throwable $e) {
                report($e);
            }
        }
        Storage::disk('torrents')->deleteDirectory($this->stagingDir($torrent));

        $result = $torrent->resultFolder;
        $file = $torrent->storedFile;
        $torrent->delete();

        if ($withData) {
            $trash = app(TrashService::class);
            if ($result !== null && ! $result->trashed()) {
                $trash->trashFolder($result);
            }
            if ($file !== null && ! $file->trashed()) {
                $trash->trashFile($file);
            }
        }
    }

    /**
     * Хук TrashService::trashFile — .torrent-файл ушёл в корзину:
     * живую загрузку снимаем, запись задачи удаляем (в корзине файлу
     * задача не нужна — при восстановлении торрент не воскресает).
     */
    public function onFileTrashed(StoredFile $file): void
    {
        $torrent = Torrent::where('stored_file_id', $file->id)->first();
        if ($torrent !== null) {
            $this->destroy($torrent, false);
        }
    }

    /** Каталог загрузки торрента внутри диска «torrents». */
    public function stagingDir(Torrent $torrent): string
    {
        return (string) $torrent->id;
    }

    /**
     * Папка с именем $name внутри $parent, создание по пути вида
     * «a/b/c» (вложенная структура торрента). Наследует настройки
     * result-папки (конвертация/TTL).
     *
     * @param  array<string, Folder>  $dirs  кэш относительный путь → Folder
     */
    private function ensureDir(User $user, Folder $result, array &$dirs, string $relDir): Folder
    {
        if (isset($dirs[$relDir])) {
            return $dirs[$relDir];
        }

        $parent = $result;
        $prefix = '';
        foreach (explode('/', $relDir) as $segment) {
            $prefix = $prefix === '' ? $segment : $prefix.'/'.$segment;
            if (isset($dirs[$prefix])) {
                $parent = $dirs[$prefix];

                continue;
            }
            $parent = $dirs[$prefix] = Folder::create([
                'user_id' => $user->id,
                'parent_id' => $parent->id,
                'name' => $this->uniqueFolderName($user->id, $parent->id, $segment),
                'default_ttl_days' => $result->default_ttl_days,
                'conversion_enabled' => $result->conversion_enabled,
            ]);
        }

        return $parent;
    }

    private function uniqueFolderName(int $userId, ?int $parentId, string $name): string
    {
        $taken = fn (string $candidate) => Folder::where('user_id', $userId)
            ->where('parent_id', $parentId)
            ->where('name', $candidate)
            ->exists();

        if (! $taken($name)) {
            return $name;
        }
        $i = 1;
        while ($taken("{$name} ({$i})")) {
            $i++;
        }

        return "{$name} ({$i})";
    }

    /** @param  array<string, mixed>  $attrs */
    private function saveAndBroadcast(Torrent $torrent, array $attrs): void
    {
        $torrent->forceFill($attrs)->save();
        $this->broadcast($torrent);
    }

    private function broadcast(Torrent $torrent): void
    {
        event(new TorrentUpdated($torrent->user_id, [
            'id' => $torrent->id,
            'stored_file_id' => $torrent->stored_file_id,
            'status' => $torrent->status,
            'progress' => (int) $torrent->progress,
            'download_rate' => (int) $torrent->download_rate,
            'downloaded_size' => (int) $torrent->downloaded_size,
            'total_size' => (int) $torrent->total_size,
            'error' => $torrent->error,
            'result_folder_id' => $torrent->result_folder_id,
        ]));
    }
}
