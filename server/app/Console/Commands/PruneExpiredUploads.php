<?php

namespace App\Console\Commands;

use App\Models\Screenshot;
use App\Models\ShareLink;
use App\Models\StoredFile;
use Illuminate\Console\Command;

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

        $this->info("Pruned {$screenshots->count()} screenshots, {$files->count()} files, {$links} links.");

        return self::SUCCESS;
    }
}
