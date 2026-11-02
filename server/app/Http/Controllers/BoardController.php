<?php

namespace App\Http\Controllers;

use App\Models\Board;
use Illuminate\Http\Request;

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
