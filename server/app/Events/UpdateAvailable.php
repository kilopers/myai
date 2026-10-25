<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * «Доступна новая версия десктопа» — рассылается всем клиентам через
 * Reverb по публичному каналу app.updates после синхронизации релиза.
 */
class UpdateAvailable implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * @param  array<string, string>  $downloads
     */
    public function __construct(
        public string $version,
        public array $downloads,
        public ?string $notesUrl = null,
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('app.updates');
    }

    public function broadcastAs(): string
    {
        return 'app.update-available';
    }

    /**
     * @return array{version: string, downloads: array<string, string>, notes_url: ?string}
     */
    public function broadcastWith(): array
    {
        return [
            'version' => $this->version,
            'downloads' => $this->downloads,
            'notes_url' => $this->notesUrl,
        ];
    }
}
