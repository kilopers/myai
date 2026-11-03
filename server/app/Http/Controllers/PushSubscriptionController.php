<?php

namespace App\Http\Controllers;

use App\Models\Board;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Push-подписки владельца доски (гостевые — в PublicBoardController).
 * Подписка идемпотентна по endpoint_hash: повторный subscribe с
 * другой страницы/доски просто перезаписывает запись.
 */
class PushSubscriptionController extends Controller
{
    public function store(Request $request, Board $board): JsonResponse
    {
        abort_unless($board->user_id === $request->user()->id, 403);

        $sub = $board->pushSubscriptions()->updateOrCreate(
            ['endpoint_hash' => hash('sha256', $request->string('endpoint'))],
            $this->validateSub($request) + [
                'user_id' => $request->user()->id,
            ],
        );

        return response()->json($sub->only('id', 'endpoint', 'url'), 201);
    }

    public function destroy(Request $request, Board $board): Response
    {
        abort_unless($board->user_id === $request->user()->id, 403);

        $data = $request->validate(['endpoint' => ['required', 'string', 'max:2000']]);

        $board->pushSubscriptions()
            ->where('endpoint_hash', hash('sha256', $data['endpoint']))
            ->delete();

        return response()->noContent();
    }

    /** Общая с гостевым контроллером валидация тела подписки. */
    public static function validateSub(Request $request): array
    {
        $data = $request->validate([
            'endpoint' => ['required', 'string', 'max:2000'],
            'url' => ['nullable', 'string', 'max:500'],
            'keys' => ['required', 'array'],
            'keys.p256dh' => ['required', 'string', 'max:500'],
            'keys.auth' => ['required', 'string', 'max:500'],
            'content_encoding' => ['nullable', 'string', 'in:aes128gcm,aesgcm'],
        ]);

        return [
            'endpoint' => $data['endpoint'],
            'url' => $data['url'] ?? '/',
            'public_key' => $data['keys']['p256dh'],
            'auth_token' => $data['keys']['auth'],
            'content_encoding' => $data['content_encoding'] ?? 'aes128gcm',
        ];
    }
}
