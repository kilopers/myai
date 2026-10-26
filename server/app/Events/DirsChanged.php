<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * «Содержимое директорий изменилось» — рассылается веб-клиентам через
 * Reverb по публичному каналу sync.user.{id} один раз на запрос.
 * Клиент сверяет присланные dir_hash с открытой папкой и перезапрашивает
 * состояние через /api/action, если хэш разошёлся.
 */
class DirsChanged implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * @param  list<array{folder_id: int|null, dir_hash: string|null}>  $dirs
     */
    public function __construct(
        public int $userId,
        public array $dirs,
        public ?string $screenshotsHash = null,
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('sync.user.'.$this->userId);
    }

    public function broadcastAs(): string
    {
        return 'dirs.changed';
    }

    /**
     * @return array{dirs: list<array{folder_id: int|null, dir_hash: string|null}>, screenshots_hash?: string}
     */
    public function broadcastWith(): array
    {
        return array_filter([
            'dirs' => $this->dirs,
            'screenshots_hash' => $this->screenshotsHash,
        ], fn ($v) => $v !== null);
    }
}
