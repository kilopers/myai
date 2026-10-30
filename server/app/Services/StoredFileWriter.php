<?php

namespace App\Services;

use App\Events\FileConversionUpdated;
use App\Jobs\ProcessUploadedFile;
use App\Models\Folder;
use App\Models\StoredFile;
use App\Models\User;
use App\Services\Conversion\ProcessorRegistry;
use App\Support\SyncHash;

/**
 * Создание записи файла и постановка на фоновую конвертацию.
 * Общий код для FileController (веб/десктоп) и публичной загрузки
 * по расшаренной ссылке (PublicShareController).
 */
class StoredFileWriter
{
    /**
     * Создаёт StoredFile для уже положенного на диск public содержимого,
     * обновляет хэши ветки и ставит файл на конвертацию.
     *
     * @param  array{uuid:string,name:string,filename:string,mime_type:?string,size:int,path:string,mtime:int}  $data
     */
    public function register(User $user, ?Folder $folder, array $data): StoredFile
    {
        $ttl = $folder?->default_ttl_days ?? $user->default_file_ttl_days;

        $file = $user->files()->create([
            'folder_id' => $folder?->id,
            'uuid' => $data['uuid'],
            'name' => $data['name'],
            'filename' => $data['filename'],
            'mime_type' => $data['mime_type'],
            'size' => $data['size'],
            'path' => $data['path'],
            'mtime' => $data['mtime'],
            'entry_hash' => SyncHash::file($data['name'], $data['size'], $data['mtime']),
            'expires_at' => $ttl ? now()->addDays($ttl) : null,
        ]);

        SyncHash::refreshFolderChain($folder, $user);
        $this->queueConversion($file);

        return $file;
    }

    /**
     * Постановка файла на фоновую пост-обработку. Файлу без подходящего
     * процессора или в папке с выключенной конвертацией остаётся
     * conversion_status=none.
     * В режиме sync-очереди джоба выполняется инлайн — её исключение
     * не должно ломать успешный ответ загрузки.
     */
    public function queueConversion(StoredFile $file): void
    {
        if ($file->folder?->conversion_enabled === false) {
            return;
        }
        if (app(ProcessorRegistry::class)->for($file->mime_type) === null) {
            return;
        }
        $file->forceFill([
            'conversion_status' => 'pending',
            'conversion_progress' => 0,
            'pages_done' => null,
            'pages_total' => null,
            'conversion_error' => null,
        ])->save();

        // Событие pending идёт сразу, не дожидаясь старта джобы: пока
        // воркер занят (напр. длинное видео), открытая папка на других
        // устройствах может получить файл только по этому событию —
        // dirs.changed мог не дойти.
        event(new FileConversionUpdated($file->user_id, [
            'file_id' => $file->id,
            'status' => 'pending',
            'progress' => 0,
            'pages_done' => null,
            'pages_total' => null,
            'has_derivatives' => false,
        ]));

        try {
            ProcessUploadedFile::dispatch($file->id);
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
