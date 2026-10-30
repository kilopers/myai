<?php

namespace App\Console\Commands;

use App\Models\Torrent;
use App\Services\DirChangeTracker;
use App\Services\Torrent\TorrentService;
use Illuminate\Console\Command;

/**
 * Опрос активных торрент-загрузок у движка (aria2 RPC). Запускается
 * планировщиком раз в минуту внутри queue-контейнера (schedule:work) и
 * внутри себя крутится ~50 сек с шагом ~2 сек — за счёт этого
 * прогресс/скорость в вебе обновляются почти в реальном времени,
 * а события torrent.updated уходят в канал sync.user.{id}.
 * Без активных торрентов завершается сразу.
 */
class PollTorrents extends Command
{
    protected $signature = 'torrents:poll';

    protected $description = 'Poll the torrent engine for active downloads and broadcast progress';

    private const RUN_SECONDS = 50;

    private const SLEEP_US = 2_000_000;

    public function handle(): int
    {
        $service = app(TorrentService::class);
        $deadline = microtime(true) + self::RUN_SECONDS;

        while (microtime(true) < $deadline) {
            $active = Torrent::where('status', Torrent::STATUS_DOWNLOADING)->get();
            if ($active->isEmpty()) {
                break;
            }
            foreach ($active as $torrent) {
                try {
                    $service->poll($torrent);
                } catch (\Throwable $e) {
                    report($e);
                }
            }
            usleep(self::SLEEP_US);
        }

        // finalize() меняет dir_hash вне HTTP-запроса — middleware там
        // нет, поэтому dirs.changed рассылаем из команды.
        app(DirChangeTracker::class)->flushAll();

        return self::SUCCESS;
    }
}
