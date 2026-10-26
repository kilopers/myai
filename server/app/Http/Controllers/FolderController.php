<?php

namespace App\Http\Controllers;

use App\Models\Folder;
use App\Services\TrashService;
use App\Support\SyncHash;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

class FolderController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $folders = $request->user()->folders()->withCount('files')->latest()->get();

        return JsonResource::collection($folders);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'parent_id' => [
                'nullable',
                'integer',
                Rule::exists('folders', 'id')->where('user_id', $request->user()->id),
            ],
            'default_ttl_days' => ['nullable', 'integer', 'min:1', 'max:36500'],
        ]);

        $folder = $request->user()->folders()->create($validated);

        SyncHash::refreshFolderChain($folder->parent, $request->user());

        return (new JsonResource($folder))->response()->setStatusCode(201);
    }

    public function update(Request $request, Folder $folder): JsonResource
    {
        abort_unless($folder->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'default_ttl_days' => ['nullable', 'integer', 'min:1', 'max:36500'],
        ]);

        abort_if(
            $folder->is_system && isset($validated['name']),
            422,
            'Системную папку переименовать нельзя.',
        );

        $nameChanged = isset($validated['name']) && $validated['name'] !== $folder->name;
        $folder->update($validated);

        if ($nameChanged) {
            SyncHash::refreshFolderChain($folder->parent, $request->user());
        }

        return new JsonResource($folder);
    }

    /**
     * Удаление папки — в корзину со всем содержимым (soft-delete).
     * Системную папку «Скриншоты» удалить нельзя.
     */
    public function destroy(Request $request, Folder $folder): JsonResponse
    {
        abort_unless($folder->user_id === $request->user()->id, 403);
        abort_if($folder->is_system, 422, 'Системную папку удалить нельзя.');

        app(TrashService::class)->trashFolder($folder);

        return response()->json(['message' => 'Moved to trash.']);
    }
}
