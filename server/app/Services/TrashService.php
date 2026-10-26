<?php

namespace App\Services;

use App\Models\DeletedFile;
use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\StoredFile;
use App\Models\User;
use App\Support\SyncHash;

/**
 * Корзина: любое удаление файла/скриншота/папки переводит запись в
 * корзину (soft-delete), физический файл остаётся на диске, share-ссылки
 * удаляются. В лог удалённых (deleted_files) пишется tombstone для
 * десктопной синхронизации. Очистка — uploads:prune по
 * users.trash_retention_days.
 */
class TrashService
{
    /**
     * Материализованный путь папки вида «a/b» ('' для корня).
     */
    public static function dirPath(?Folder $folder): string
    {
        $parts = [];
        while ($folder !== null) {
            array_unshift($parts, $folder->name);
            $folder = $folder->parent;
        }

        return implode('/', $parts);
    }

    public function trashFile(StoredFile $file): void
    {
        $dir = self::dirPath($file->folder);
        $file->shareLinks()->delete();
        $this->tombstone($file->user_id, 'file', $file->name, (int) $file->size, $file->mtime, $file->entryHash(), $dir);
        $file->original_path = ltrim($dir.'/'.$file->name, '/');
        $file->saveQuietly();
        $file->delete();

        SyncHash::refreshFolderChain($file->folder, $file->user);
    }

    public function trashScreenshot(Screenshot $screenshot): void
    {
        $this->tombstone($screenshot->user_id, 'screenshot', $screenshot->filename, (int) $screenshot->size, $screenshot->mtime, $screenshot->entryHash(), '');
        $screenshot->original_path = $screenshot->filename;
        $screenshot->saveQuietly();
        $screenshot->delete();

        app(DirChangeTracker::class)->markScreenshots($screenshot->user_id);
    }

    /**
     * Папка уходит в корзину вместе со всем содержимым: файлы получают
     * корректный original_path, share-ссылки дерева удаляются.
     */
    public function trashFolder(Folder $folder): void
    {
        abort_if($folder->is_system, 422, 'Системную папку удалить нельзя.');

        $this->trashFolderTree($folder);
    }

    private function trashFolderTree(Folder $folder): void
    {
        foreach ($folder->children as $child) {
            $this->trashFolderTree($child);
        }
        foreach ($folder->files as $file) {
            $this->trashFile($file);
        }

        $folder->shareLinks()->delete();
        $this->tombstone(
            $folder->user_id,
            'folder',
            $folder->name,
            0,
            null,
            SyncHash::folderEntry($folder->name, $folder->dirHash()),
            self::dirPath($folder->parent),
        );
        $folder->delete();
        app(DirChangeTracker::class)->markFolderDeleted($folder);

        SyncHash::refreshFolderChain($folder->parent, $folder->user);
    }

    /**
     * Восстановление файла из корзины: цепочка папок по original_path
     * пересоздаётся при отсутствии, коллизия имён — суффикс «(1)».
     */
    public function restoreFile(StoredFile $file): StoredFile
    {
        $original = trim((string) $file->original_path, '/');
        $dir = str_contains($original, '/') ? (string) str($original)->beforeLast('/') : '';
        $folder = $this->ensureFolderChain($file->user, $dir);

        $file->name = $this->uniqueFileName($file->user_id, $folder?->id, $file->name);
        $file->folder_id = $folder?->id;
        $file->original_path = null;
        $file->deleted_at = null;
        $file->refreshEntryHash();
        $file->save();

        SyncHash::refreshFolderChain($folder, $file->user);

        return $file;
    }

    /**
     * Скриншот восстанавливается в галерею/папку «Скриншоты».
     */
    public function restoreScreenshot(Screenshot $screenshot): Screenshot
    {
        $screenshot->original_path = null;
        $screenshot->deleted_at = null;
        $screenshot->refreshEntryHash();
        $screenshot->save();

        app(DirChangeTracker::class)->markScreenshots($screenshot->user_id);

        return $screenshot;
    }

    /**
     * Удаление насовсем: физический файл + запись. Tombstone уже был
     * записан при помещении в корзину — повторно не пишем.
     */
    public function purgeFile(StoredFile $file): void
    {
        $file->deleteFile();
        $file->forceDelete();
    }

    public function purgeScreenshot(Screenshot $screenshot): void
    {
        $screenshot->deleteFile();
        $screenshot->forceDelete();
    }

    /**
     * Насовсем — для корзинных папок (retention): сначала содержимое,
     * потом сама папка (FK cascade удалит сирот-жёстко, поэтому порядок
     * важен — файлы нужно удалить физически до forceDelete папки).
     */
    public function purgeFolder(Folder $folder): void
    {
        foreach ($folder->children()->withTrashed()->get() as $child) {
            $this->purgeFolder($child);
        }
        foreach ($folder->files()->withTrashed()->get() as $file) {
            $this->purgeFile($file);
        }
        $folder->forceDelete();
        app(DirChangeTracker::class)->markFolderDeleted($folder);
    }

    private function tombstone(int $userId, string $kind, string $name, int $size, ?int $mtime, string $entryHash, string $dirPath): void
    {
        DeletedFile::create([
            'user_id' => $userId,
            'kind' => $kind,
            'name' => $name,
            'size' => $size,
            'mtime' => $mtime,
            'entry_hash' => $entryHash,
            'dir_path' => $dirPath,
            'deleted_at' => now(),
        ]);
    }

    /**
     * Пересоздать цепочку папок по пути «a/b/c». Возвращает самую
     * глубокую папку или null для корня.
     */
    private function ensureFolderChain(User $user, string $path): ?Folder
    {
        if ($path === '') {
            return null;
        }

        $parent = null;
        foreach (explode('/', $path) as $name) {
            $query = Folder::where('user_id', $user->id)->where('name', $name);
            $parent === null
                ? $query->whereNull('parent_id')
                : $query->where('parent_id', $parent->id);
            $parent = $query->first() ?? Folder::create([
                'user_id' => $user->id,
                'name' => $name,
                'parent_id' => $parent?->id,
            ]);
        }

        return $parent;
    }

    /**
     * Уникальное имя в целевой папке: «имя (1).ext», «имя (2).ext»…
     */
    private function uniqueFileName(int $userId, ?int $folderId, string $name): string
    {
        $exists = fn (string $candidate) => StoredFile::where('user_id', $userId)
            ->where('name', $candidate)
            ->when(
                $folderId === null,
                fn ($q) => $q->whereNull('folder_id'),
                fn ($q) => $q->where('folder_id', $folderId),
            )->exists();

        if (! $exists($name)) {
            return $name;
        }

        $base = pathinfo($name, PATHINFO_FILENAME);
        $extension = pathinfo($name, PATHINFO_EXTENSION);
        for ($i = 1; ; $i++) {
            $candidate = $extension !== ''
                ? "{$base} ({$i}).{$extension}"
                : "{$name} ({$i})";
            if (! $exists($candidate)) {
                return $candidate;
            }
        }
    }
}
