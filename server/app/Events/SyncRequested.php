<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * «Синхронизировать эту ветку» из веба → десктоп через Reverb.
 * Публичный канал на пользователя; подписывается десктопный ws-монитор.
 */
class SyncRequested implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $userId,
        public ?int $folderId = null,
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('sync.user.'.$this->userId);
    }

    public function broadcastAs(): string
    {
        return 'sync.requested';
    }
}
