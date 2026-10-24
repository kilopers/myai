<?php

namespace App\Http\Controllers;

use App\Models\Folder;
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

        return (new JsonResource($folder))->response()->setStatusCode(201);
    }

    public function update(Request $request, Folder $folder): JsonResource
    {
        abort_unless($folder->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'default_ttl_days' => ['nullable', 'integer', 'min:1', 'max:36500'],
        ]);

        $folder->update($validated);

        return new JsonResource($folder);
    }

    public function destroy(Request $request, Folder $folder): JsonResponse
    {
        abort_unless($folder->user_id === $request->user()->id, 403);

        $this->deleteTree($folder);

        return response()->json(['message' => 'Deleted.']);
    }

    private function deleteTree(Folder $folder): void
    {
        foreach ($folder->children as $child) {
            $this->deleteTree($child);
        }
        foreach ($folder->files as $file) {
            $file->shareLinks()->delete();
            $file->deleteFile();
        }
        $folder->shareLinks()->delete();
        $folder->delete();
    }
}
