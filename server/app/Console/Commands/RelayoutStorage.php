<?php

namespace App\Console\Commands;

use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\StoredFile;
use App\Models\User;
use App\Support\StoragePath;
use App\Support\SyncHash;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Разовая (идемпотентная) миграция хранилища на единую двухуровневую
 * раскладку files/{ab}/{cd}/{uuid}.{ext}: перекладывает физические
 * файлы и скриншоты, обновляет path, проставляет mtime/entry_hash,
 * создаёт системную папку «Скриншоты» и пересчитывает dir_hash папок.
 */
class RelayoutStorage extends Command
{
    protected $signature = 'storage:relayout';

    protected $description = 'Migrate uploads to the files/{ab}/{cd} two-level layout and fill sync hashes';

    public function handle(): int
    {
        $disk = Storage::disk('public');
        [$moved, $missing, $updated] = [0, 0, 0];

        $migrate = function (StoredFile|Screenshot $m) use ($disk, &$moved, &$missing, &$updated) {
            $uuid = (string) $m->uuid;
            $extension = strtolower(pathinfo($m->path, PATHINFO_EXTENSION) ?: pathinfo($m->filename, PATHINFO_EXTENSION) ?: 'bin');
            $newPath = StoragePath::file($uuid, $extension);
            $isScreenshot = $m instanceof Screenshot;

            if ($m->path !== $newPath) {
                if ($disk->exists($m->path)) {
                    $disk->move($m->path, $newPath);
                    $moved++;
                } elseif (! $disk->exists($newPath)) {
                    $missing++;
                    $this->warn("Файл не найден ни по старому, ни по новому пути: {$m->path} (id {$m->id})");
                }
                $m->path = $newPath;
            }

            if ($m->mtime === null) {
                $m->mtime = $disk->exists($newPath)
                    ? $disk->lastModified($newPath)
                    : ($m->created_at?->getTimestamp() ?? now()->getTimestamp());
            }

            $name = $isScreenshot ? $m->filename : $m->name;
            $hash = SyncHash::file($name, (int) $m->size, $m->mtime);
            if ($m->entry_hash !== $hash) {
                $m->entry_hash = $hash;
            }

            if ($m->isDirty()) {
                $m->saveQuietly();
                $updated++;
            }
        };

        StoredFile::withTrashed()->lazy()->each($migrate);
        Screenshot::withTrashed()->lazy()->each($migrate);

        // Системная папка «Скриншоты» — каждому пользователю со скриншотами
        // (и не только: создаём всем — десктопная синхронизация ждёт её).
        $folders = 0;
        foreach (User::lazy() as $user) {
            $before = Folder::withTrashed()
                ->where('user_id', $user->id)
                ->whereNull('parent_id')
                ->where('name', Folder::SCREENSHOTS_DIR)
                ->exists();
            Folder::screenshotsFolder($user);
            if (! $before) {
                $folders++;
            }
        }

        // dir_hash всех папок снизу вверх
        foreach (User::lazy() as $user) {
            SyncHash::rebuildUserHashes($user);
        }

        $this->info("Moved: {$moved}, updated rows: {$updated}, missing files: {$missing}, screenshots folders: {$folders}.");

        return self::SUCCESS;
    }
}
