<?php

namespace App\Http\Controllers;

use App\Models\Board;
use App\Models\BoardTask;
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

    /** Публичный просмотр доски по токену — без авторизации, read-only. */
    public function publicShow(string $token)
    {
        $board = Board::where('share_token', $token)->firstOrFail();

        return [
            'board' => $board->only('id', 'name', 'prefix'),
            'columns' => $board->columns()->with([
                'tasks' => fn ($q) => $q->withCount(['comments', 'attachments']),
            ])->get(),
        ];
    }

    /** Комментарии задачи публичной доски — токен должен совпасть. */
    public function publicComments(string $token, BoardTask $task)
    {
        abort_unless($task->column->board->share_token === $token, 404);

        return $task->comments()->with('user:id,name')->get();
    }

    /** Комментарий гостя: user_id пуст, имя — в guest_name. */
    public function publicStoreComment(Request $request, string $token, BoardTask $task)
    {
        abort_unless($task->column->board->share_token === $token, 404);

        $data = $request->validate([
            'guest_name' => ['required', 'string', 'max:120'],
            'text' => ['required', 'string', 'max:2000'],
        ]);

        $comment = $task->comments()->create([
            'user_id' => null,
            'guest_name' => trim($data['guest_name']),
            'text' => trim($data['text']),
        ]);

        return response()->json($comment->load('user:id,name'), 201);
    }

    /** Отзыв гостевой ссылки — старый URL перестаёт работать. */
    public function revokeShareLink(Request $request, Board $board)
    {
        abort_unless($board->user_id === $request->user()->id, 403);

        $board->update(['share_token' => null]);

        return response()->noContent();
    }

    public function destroy(Request $request, Board $board)
    {
        abort_unless($board->user_id === $request->user()->id, 403);
        $board->load('columns.tasks.attachments');
        $board->columns->each(
            fn ($column) => $column->tasks->each(fn ($task) => $task->attachments->each->deleteFile())
        );
        $board->delete();

        return response()->noContent();
    }
}
