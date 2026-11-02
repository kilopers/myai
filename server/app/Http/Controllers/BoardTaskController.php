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
            'text' => ['nullable', 'string'],
        ]);

        $column = BoardColumn::findOrFail($data['board_column_id']);
        abort_unless($column->board->user_id === $request->user()->id, 403);

        // Новая задача — первой в колонке: раздвигаем остальные.
        $column->tasks()->increment('position');

        // Сквозной номер в рамках доски — для бейджа PREFIX-N.
        $number = $column->board->next_task_number;
        $column->board->increment('next_task_number');

        $task = $column->tasks()->create([
            'title' => $data['title'],
            'text' => $data['text'] ?? null,
            'position' => 0,
            'number' => $number,
        ]);

        return response()->json($task, 201);
    }

    public function update(Request $request, BoardTask $boardTask)
    {
        abort_unless($boardTask->column->board->user_id === $request->user()->id, 403);

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:200'],
            'text' => ['nullable', 'string'],
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
        $boardTask->attachments->each->deleteFile();
        $boardTask->delete();

        return response()->noContent();
    }
}
