<?php

namespace App\Jobs;

use App\Services\DesktopReleaseSync;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Фоновая синхронизация релиза десктопа — ставится webhook'ом
 * /api/desktop-release/sync после публикации GitHub Release.
 */
class DesktopReleaseSyncJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var array<int, int> */
    public array $backoff = [30, 120];

    public function __construct(public string $version) {}

    public function handle(DesktopReleaseSync $sync): void
    {
        $manifest = $sync->sync($this->version);
        $sync->broadcastIfNew($manifest);
    }
}
