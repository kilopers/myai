<?php

namespace App\Services;

use App\Models\Board;
use App\Models\BoardTask;
use App\Models\BoardTaskComment;
use App\Models\PushSubscription;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * Web Push по доске: уведомления уходят только подписчикам
 * конкретной доски (push_subscriptions.board_id). Транспорт —
 * minishlink/web-push (VAPID-ключи из services.webpush); в тестах
 * WebPush подменяется фейком через app->instance(WebPush::class).
 */
class BoardPushService
{
    public function __construct(private WebPush $webPush) {}

    /** Пуш «новая задача» всем подписчикам доски задачи. */
    public function taskCreated(BoardTask $task, ?string $excludeEndpoint = null): void
    {
        $board = $task->column->board;
        $key = $this->taskKey($board, $task);

        $this->notify($board, [
            'title' => $board->name,
            'body' => "Новая задача {$key}: {$task->title}",
            'tag' => "board-{$board->id}-task-{$task->id}",
            'url_suffix' => '?task='.urlencode($key),
        ], $excludeEndpoint);
    }

    /** Пуш «новый комментарий» подписчикам доски задачи. */
    public function commentCreated(BoardTaskComment $comment, ?string $excludeEndpoint = null): void
    {
        $task = $comment->task;
        $board = $task->column->board;
        $key = $this->taskKey($board, $task);
        $author = $comment->user?->name ?? $comment->guest_name ?? 'Гость';
        $text = trim((string) $comment->text);

        $this->notify($board, [
            'title' => $board->name,
            'body' => $text !== ''
                ? "{$author} ({$key}): ".mb_strimwidth($text, 0, 120, '…')
                : "{$author} ({$key}): вложение",
            'tag' => "board-{$board->id}-task-{$task->id}",
            'url_suffix' => '?task='.urlencode($key),
        ], $excludeEndpoint);
    }

    /**
     * Рассылка по подпискам доски; exclude_endpoint пропускает
     * подписку устройства, с которого выполнено действие.
     *
     * @param  array{title:string,body:string,tag:string,url_suffix:string}  $n
     */
    public function notify(Board $board, array $n, ?string $excludeEndpoint = null): void
    {
        $vapid = config('services.webpush.vapid');
        if (! ($vapid['publicKey'] ?? null) || ! ($vapid['privateKey'] ?? null)) {
            return; // VAPID не настроен — пуши выключены
        }

        $subs = $board->pushSubscriptions()
            ->when($excludeEndpoint, fn ($q) => $q->where(
                'endpoint_hash', '!=', hash('sha256', $excludeEndpoint)
            ))
            ->get();

        foreach ($subs as $sub) {
            $this->send($sub, $n);
        }
    }

    /** Отправка одной подписке; протухшая (404/410) удаляется. */
    private function send(PushSubscription $sub, array $n): void
    {
        $board = $sub->board;
        // Иконка по токену подписчика: у владельца — manifest_token,
        // у гостя — share_token (оба открывают публичный роут).
        $token = $sub->user_id ? $board->manifest_token : $board->share_token;
        $payload = json_encode([
            'title' => $n['title'],
            'body' => $n['body'],
            'icon' => "/api/board-apps/{$token}/icons/icon-192.png",
            'tag' => $n['tag'],
            'url' => $sub->url.$n['url_suffix'],
        ], JSON_UNESCAPED_UNICODE);

        try {
            $report = $this->webPush->sendOneNotification(
                Subscription::create([
                    'endpoint' => $sub->endpoint,
                    'publicKey' => $sub->public_key,
                    'authToken' => $sub->auth_token,
                    'contentEncoding' => $sub->content_encoding,
                ]),
                $payload,
            );

            if ($report->isSubscriptionExpired()) {
                $sub->delete();
            } elseif (! $report->isSuccess()) {
                Log::warning('web-push: отправка не удалась', [
                    'subscription' => $sub->id, 'reason' => $report->getReason(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('web-push: ошибка отправки', [
                'subscription' => $sub->id, 'error' => $e->getMessage(),
            ]);
        }
    }

    /** Ключ задачи в адресной строке: PREFIX-N или просто N. */
    private function taskKey(Board $board, BoardTask $task): string
    {
        return $board->prefix && $task->number !== null
            ? "{$board->prefix}-{$task->number}"
            : (string) ($task->number ?? $task->id);
    }
}
