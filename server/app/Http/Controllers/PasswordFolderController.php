<?php

namespace App\Http\Controllers;

use App\Models\PasswordFolder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;

class PasswordFolderController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $folders = $request->user()->passwordFolders()
            ->withCount('entries')
            ->orderBy('name')
            ->get();

        return JsonResource::collection($folders);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
        ]);

        $folder = $request->user()->passwordFolders()->create($validated);

        return (new JsonResource($folder))->response()->setStatusCode(201);
    }

    public function update(Request $request, PasswordFolder $passwordFolder): JsonResource
    {
        abort_unless($passwordFolder->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
        ]);

        $passwordFolder->update($validated);

        return new JsonResource($passwordFolder);
    }

    /**
     * Удаление папки вместе с записями (FK cascade) —
     * корзины у справочника паролей нет, удаление сразу.
     */
    public function destroy(Request $request, PasswordFolder $passwordFolder): JsonResponse
    {
        abort_unless($passwordFolder->user_id === $request->user()->id, 403);

        $passwordFolder->delete();

        return response()->json(['message' => 'Deleted.']);
    }
}
