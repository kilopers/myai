<?php

namespace App\Http\Controllers;

use App\Models\NoteFolder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;

class NoteFolderController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $folders = $request->user()->noteFolders()
            ->withCount('notes')
            ->orderBy('name')
            ->get();

        return JsonResource::collection($folders);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
        ]);

        $folder = $request->user()->noteFolders()->create($validated);

        return (new JsonResource($folder))->response()->setStatusCode(201);
    }

    public function update(Request $request, NoteFolder $noteFolder): JsonResource
    {
        abort_unless($noteFolder->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
        ]);

        $noteFolder->update($validated);

        return new JsonResource($noteFolder);
    }

    /**
     * Удаление папки вместе с заметками (FK cascade) — корзины нет.
     */
    public function destroy(Request $request, NoteFolder $noteFolder): JsonResponse
    {
        abort_unless($noteFolder->user_id === $request->user()->id, 403);

        $noteFolder->delete();

        return response()->json(['message' => 'Deleted.']);
    }
}
