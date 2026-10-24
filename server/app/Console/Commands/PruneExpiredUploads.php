<?php

namespace App\Console\Commands;

use App\Models\Screenshot;
use App\Models\ShareLink;
use App\Models\StoredFile;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class PruneExpiredUploads extends Command
{
    protected $signature = 'uploads:prune';

    protected $description = 'Delete screenshots, files and share links past their expiry date';

    public function handle(): int
    {
        $screenshots = Screenshot::whereNotNull('expires_at')
            ->where('expires_at', '<=', now())->get();
        foreach ($screenshots as $s) {
            $s->deleteFile();
            $s->delete();
        }

        $files = StoredFile::whereNotNull('expires_at')
            ->where('expires_at', '<=', now())->get();
        foreach ($files as $f) {
            $f->shareLinks()->delete();
            $f->deleteFile();
            $f->delete();
        }

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

        $this->info("Pruned {$screenshots->count()} screenshots, {$files->count()} files, {$links} links, {$chunks} stale uploads.");

        return self::SUCCESS;
    }
}
