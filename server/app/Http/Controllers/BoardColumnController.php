<?php

namespace App\Http\Controllers;

use App\Models\Board;
use App\Models\BoardColumn;
use Illuminate\Http\Request;

class BoardColumnController extends Controller
{
    public function index(Request $request)
    {
        $board = Board::findOrFail($request->integer('board_id'));
        abort_unless($board->user_id === $request->user()->id, 403);

        return $board->columns()->with(['tasks.attachments', 'tasks' => fn ($q) => $q->withCount('comments')])->get();
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'board_id' => ['required', 'integer'],
            'name' => ['required', 'string', 'max:120'],
            'color' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ]);

        $board = Board::findOrFail($data['board_id']);
        abort_unless($board->user_id === $request->user()->id, 403);

        $column = $board->columns()->create([
            'name' => $data['name'],
            'color' => $data['color'] ?? '#526de3',
            'position' => (int) $board->columns()->max('position') + 1,
        ]);

        return response()->json(
            $column->load(['tasks.attachments', 'tasks' => fn ($q) => $q->withCount('comments')]),
            201,
        );
    }

    /**
     * Порядок задач внутри колонки: полный список id — position = индекс.
     */
    public function reorderTasks(Request $request, BoardColumn $boardColumn)
    {
        abort_unless($boardColumn->board->user_id === $request->user()->id, 403);

        $data = $request->validate([
            'task_ids' => ['required', 'array'],
            'task_ids.*' => ['integer'],
        ]);

        $tasks = $boardColumn->tasks()->whereIn('id', $data['task_ids'])->get()->keyBy('id');
        foreach ($data['task_ids'] as $i => $id) {
            if (isset($tasks[$id])) {
                $tasks[$id]->update(['position' => $i]);
            }
        }

        return response()->noContent();
    }

    public function update(Request $request, BoardColumn $boardColumn)
    {
        abort_unless($boardColumn->board->user_id === $request->user()->id, 403);

        $boardColumn->update($request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'color' => ['sometimes', 'required', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ]));

        return $boardColumn;
    }

    public function destroy(Request $request, BoardColumn $boardColumn)
    {
        abort_unless($boardColumn->board->user_id === $request->user()->id, 403);
        $boardColumn->tasks->each(fn ($task) => $task->attachments->each->deleteFile());
        $boardColumn->delete();

        return response()->noContent();
    }
}
