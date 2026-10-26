<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Прогресс фоновой конвертации файла — на публичный канал
 * sync.user.{id} (тот же, что у dirs.changed). Веб обновляет
 * прогресс-бар и статус в карточке файла без перезагрузки списка.
 */
class FileConversionUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * @param  array{file_id: int, status: string, progress: int, pages_done?: int|null, pages_total?: int|null, has_derivatives?: bool}  $payload
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
        return 'file.conversion';
    }

    /** @return array{file_id: int, status: string, progress: int, pages_done?: int|null, pages_total?: int|null, has_derivatives?: bool} */
    public function broadcastWith(): array
    {
        return $this->payload;
    }
}
