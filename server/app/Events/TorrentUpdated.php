<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Статус/прогресс торрент-загрузки — на публичный канал
 * sync.user.{id} (тот же, что dirs.changed и file.conversion).
 * Веб точечно обновляет карточку .torrent-файла без перезагрузки.
 */
class TorrentUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * @param  array{id:int, stored_file_id:int|null, status:string, progress:int, download_rate:int, downloaded_size:int, total_size:int, error:?string, result_folder_id:int|null}  $payload
     */
    public function __construct(
        public int $userId,
        public array $payload,
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('sync.user.'.$this->userId);
    }

    public function broadcastAs(): string
    {
        return 'torrent.updated';
    }

    /** @return array{id:int, stored_file_id:int|null, status:string, progress:int, download_rate:int, downloaded_size:int, total_size:int, error:?string, result_folder_id:int|null} */
    public function broadcastWith(): array
    {
        return $this->payload;
    }
}
