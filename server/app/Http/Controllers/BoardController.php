<?php

namespace App\Http\Controllers;

use App\Models\Board;
use App\Services\BoardIcon;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class BoardController extends Controller
{
    public function index(Request $request)
    {
        $boards = $request->user()->boards()->orderBy('name');

        if ($request->boolean('all')) {
            return $boards->get();
        }

        $q = trim((string) $request->query('q', ''));
        if ($q !== '') {
            $boards->where('name', 'like', '%'.addcslashes($q, '%_\\').'%');
        }

        return $boards->paginate(20);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'prefix' => ['nullable', 'string', 'max:10', 'regex:/^[A-Z]+$/'],
            'guest_permissions' => ['nullable', 'array'],
            'guest_permissions.*' => ['boolean'],
        ]);

        $board = $request->user()->boards()->create($data);

        return response()->json($board, 201);
    }

    public function update(Request $request, Board $board)
    {
        abort_unless($board->user_id === $request->user()->id, 403);

        $board->update($request->validate([
            'name' => ['required', 'string', 'max:120'],
            'prefix' => ['nullable', 'string', 'max:10', 'regex:/^[A-Z]+$/'],
            'guest_permissions' => ['nullable', 'array'],
            'guest_permissions.*' => ['boolean'],
        ]));

        return $board;
    }

    /** Гостевая ссылка: лениво создаёт токен и отдаёт публичный URL. */
    public function shareLink(Request $request, Board $board)
    {
        abort_unless($board->user_id === $request->user()->id, 403);

        if (! $board->share_token) {
            $board->update(['share_token' => Str::random(48)]);
        }

        return ['url' => "/b/{$board->share_token}"];
    }

    /** Отзыв гостевой ссылки — старый URL перестаёт работать. */
    public function revokeShareLink(Request $request, Board $board)
    {
        abort_unless($board->user_id === $request->user()->id, 403);

        $board->update(['share_token' => null]);
        // Подписки гостей этой ссылки больше не актуальны
        $board->pushSubscriptions()->whereNull('user_id')->delete();

        return response()->noContent();
    }

    /** Иконка доски (PWA): своя картинка → PNG 192/512 + maskable. */
    public function storeIcon(Request $request, Board $board, BoardIcon $icons)
    {
        abort_unless($board->user_id === $request->user()->id, 403);

        $request->validate([
            'icon' => ['required', 'file', 'mimes:png,jpg,jpeg,webp,gif', 'max:5120'],
        ]);

        $icons->storeUpload($board, $request->file('icon'));

        return response()->json(['icon_url' => $board->fresh()->icon_url], 201);
    }

    /** Сброс иконки на автогенерацию из prefix/названия. */
    public function destroyIcon(Request $request, Board $board, BoardIcon $icons)
    {
        abort_unless($board->user_id === $request->user()->id, 403);

        $icons->reset($board);

        return response()->json(['icon_url' => $board->fresh()->icon_url]);
    }

    public function destroy(Request $request, Board $board, BoardIcon $icons)
    {
        abort_unless($board->user_id === $request->user()->id, 403);
        $board->load('columns.tasks.attachments');
        $board->columns->each(
            fn ($column) => $column->tasks->each(fn ($task) => $task->attachments->each->deleteFile())
        );
        $icons->deleteFiles($board);
        $board->delete();

        return response()->noContent();
    }
}
