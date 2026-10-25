<?php

namespace App\Console\Commands;

use App\Services\DesktopReleaseSync;
use Illuminate\Console\Command;
use RuntimeException;

class SyncDesktopRelease extends Command
{
    protected $signature = 'app:desktop-release-sync {version? : Версия релиза (по умолчанию — из файла VERSION)}';

    protected $description = 'Скачать артефакты GitHub Release в хранилище и обновить desktop/latest.json';

    public function handle(DesktopReleaseSync $sync): int
    {
        $version = $this->argument('version') ?: $sync->appVersion();
        $before = $sync->manifest()['version'] ?? null;

        try {
            $manifest = $sync->sync($version);
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $files = collect($manifest['files'] ?? [])
            ->map(fn (string $name, string $platform) => "{$platform}: {$name}")
            ->implode(', ');
        $this->info("Релиз v{$manifest['version']} синхронизирован".($files !== '' ? " ({$files})" : ''));

        if ($manifest['version'] !== $before) {
            if ($sync->broadcastIfNew($manifest)) {
                $this->info('Клиентам разослано уведомление об обновлении.');
            } else {
                $this->line('Уведомление для этой версии уже рассылалось.');
            }
        }

        return self::SUCCESS;
    }
}
