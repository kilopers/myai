<?php

namespace App\Jobs;

use App\Models\BoardTask;
use App\Models\BoardTaskComment;
use App\Services\BoardPushService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Отправка web-push подписчикам доски в фоне: сеть до push-сервисов
 * не должна тормозить ответ API. События: task/comment.
 */
class SendBoardPush implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public string $event,
        public int $id,
        public ?string $excludeEndpoint = null,
    ) {}

    public function handle(BoardPushService $push): void
    {
        match ($this->event) {
            'task' => ($task = BoardTask::find($this->id))
                && $push->taskCreated($task, $this->excludeEndpoint),
            'comment' => ($comment = BoardTaskComment::find($this->id))
                && $push->commentCreated($comment, $this->excludeEndpoint),
            default => null,
        };
    }
}
