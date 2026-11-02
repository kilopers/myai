<?php

namespace App\Http\Controllers;

use App\Models\BoardColumn;
use App\Models\BoardTask;
use Illuminate\Http\Request;

class BoardTaskController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'board_column_id' => ['required', 'integer'],
            'title' => ['required', 'string', 'max:200'],
            'text' => ['nullable', 'string', 'max:10000'],
        ]);

        $column = BoardColumn::findOrFail($data['board_column_id']);
        abort_unless($column->board->user_id === $request->user()->id, 403);

        $task = $column->tasks()->create([
            'title' => $data['title'],
            'text' => $data['text'] ?? null,
            'position' => (int) $column->tasks()->max('position') + 1,
        ]);

        return response()->json($task, 201);
    }

    public function update(Request $request, BoardTask $boardTask)
    {
        abort_unless($boardTask->column->board->user_id === $request->user()->id, 403);

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:200'],
            'text' => ['nullable', 'string', 'max:10000'],
            'board_column_id' => ['sometimes', 'integer'],
            'position' => ['sometimes', 'integer', 'min:0'],
        ]);

        if (isset($data['board_column_id'])) {
            $target = BoardColumn::findOrFail($data['board_column_id']);
            abort_unless($target->board->user_id === $request->user()->id, 403);
            if (! array_key_exists('position', $data)) {
                $data['position'] = (int) $target->tasks()->max('position') + 1;
            }
        }

        $boardTask->update($data);

        return $boardTask;
    }

    public function destroy(Request $request, BoardTask $boardTask)
    {
        abort_unless($boardTask->column->board->user_id === $request->user()->id, 403);
        $boardTask->delete();

        return response()->noContent();
    }
}
