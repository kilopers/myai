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

        return $board->columns()->with('tasks')->get();
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

        return response()->json($column->load('tasks'), 201);
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
        $boardColumn->delete();

        return response()->noContent();
    }
}
