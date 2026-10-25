<?php

namespace App\Console\Commands;

use App\Models\DeletedFile;
use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\ShareLink;
use App\Models\StoredFile;
use App\Services\TrashService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class PruneExpiredUploads extends Command
{
    protected $signature = 'uploads:prune';

    protected $description = 'Delete screenshots, files and share links past their expiry date';

    public function handle(): int
    {
        $trash = app(TrashService::class);

        // Истёк срок хранения → корзина (единое поведение удаления)
        $screenshots = Screenshot::whereNotNull('expires_at')
            ->where('expires_at', '<=', now())->get();
        foreach ($screenshots as $s) {
            $trash->trashScreenshot($s);
        }

        $files = StoredFile::whereNotNull('expires_at')
            ->where('expires_at', '<=', now())->get();
        foreach ($files as $f) {
            $trash->trashFile($f);
        }

        // Корзина: физическое удаление по users.trash_retention_days
        $purgedFiles = 0;
        foreach (StoredFile::onlyTrashed()->with('user')->get() as $f) {
            $days = $f->user?->trash_retention_days ?? 14;
            if ($f->deleted_at->copy()->addDays($days)->isPast()) {
                $trash->purgeFile($f);
                $purgedFiles++;
            }
        }

        $purgedShots = 0;
        foreach (Screenshot::onlyTrashed()->with('user')->get() as $s) {
            $days = $s->user?->trash_retention_days ?? 14;
            if ($s->deleted_at->copy()->addDays($days)->isPast()) {
                $trash->purgeScreenshot($s);
                $purgedShots++;
            }
        }

        $purgedFolders = 0;
        foreach (Folder::onlyTrashed()->with('user')->get() as $folder) {
            $days = $folder->user?->trash_retention_days ?? 14;
            if ($folder->deleted_at->copy()->addDays($days)->isPast()) {
                $trash->purgeFolder($folder);
                $purgedFolders++;
            }
        }

        // Tombstone-лог: записи старше 6 месяцев
        $tombs = DeletedFile::where('deleted_at', '<=', now()->subMonths(6))->delete();

        $links = ShareLink::whereNotNull('expires_at')
            ->where('expires_at', '<=', now())->delete();

        // Недособранные чанковые загрузки старше суток
        $chunks = 0;
        foreach (Storage::directories('chunks') as $userDir) {
            foreach (Storage::directories($userDir) as $uploadDir) {
                $parts = Storage::files($uploadDir);
                $stale = collect($parts)->every(
                    fn (string $p) => Storage::lastModified($p) < now()->subDay()->getTimestamp()
                );
                if ($stale) {
                    Storage::deleteDirectory($uploadDir);
                    $chunks++;
                }
            }
        }

        $this->info("Expired → trash: {$screenshots->count()} shots, {$files->count()} files. "
            ."Purged: {$purgedShots} shots, {$purgedFiles} files, {$purgedFolders} folders. "
            ."Tombstones: {$tombs}, links: {$links}, stale uploads: {$chunks}.");

        return self::SUCCESS;
    }
}
