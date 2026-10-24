<?php

namespace App\Http\Controllers;

use App\Http\Resources\StoredFileResource;
use App\Models\Folder;
use App\Models\StoredFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class FileController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $query = $request->user()->files()->latest();

        if ($request->has('folder_id')) {
            $query->where('folder_id', $request->integer('folder_id'));
        } else {
            $query->whereNull('folder_id');
        }

        return StoredFileResource::collection($query->paginate(60));
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:8388608'],
            'folder_id' => ['nullable', 'integer'],
        ]);

        $folder = null;
        if (! empty($validated['folder_id'])) {
            $folder = Folder::where('user_id', $request->user()->id)
                ->findOrFail($validated['folder_id']);
        }

        $uploaded = $request->file('file');
        $uuid = (string) Str::uuid();
        $extension = strtolower($uploaded->getClientOriginalExtension() ?: 'bin');
        $path = $uploaded->storeAs('files', "{$uuid}.{$extension}", 'public');

        $ttl = $folder?->default_ttl_days ?? $request->user()->default_file_ttl_days;

        $file = $request->user()->files()->create([
            'folder_id' => $folder?->id,
            'uuid' => $uuid,
            'name' => $uploaded->getClientOriginalName(),
            'filename' => "{$uuid}.{$extension}",
            'mime_type' => $uploaded->getMimeType(),
            'size' => $uploaded->getSize(),
            'path' => $path,
            'expires_at' => $ttl ? now()->addDays($ttl) : null,
        ]);

        return (new StoredFileResource($file))->response()->setStatusCode(201);
    }

    public function update(Request $request, StoredFile $file): StoredFileResource
    {
        abort_unless($file->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'expires_at' => ['nullable', 'date'],
            'folder_id' => ['nullable', 'integer'],
        ]);

        if (array_key_exists('folder_id', $validated) && $validated['folder_id']) {
            Folder::where('user_id', $request->user()->id)
                ->findOrFail($validated['folder_id']);
        }

        $file->update($validated);

        return new StoredFileResource($file);
    }

    public function download(Request $request, StoredFile $file): StreamedResponse
    {
        abort_unless($file->user_id === $request->user()->id, 403);
        abort_unless(Storage::disk('public')->exists($file->path), 404);

        return Storage::disk('public')->response($file->path, $file->name, [
            'Content-Type' => $file->mime_type ?: 'application/octet-stream',
        ]);
    }

    public function destroy(Request $request, StoredFile $file): JsonResponse
    {
        abort_unless($file->user_id === $request->user()->id, 403);

        $file->shareLinks()->delete();
        $file->deleteFile();
        $file->delete();

        return response()->json(['message' => 'Deleted.']);
    }
}
