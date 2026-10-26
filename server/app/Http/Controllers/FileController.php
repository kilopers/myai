<?php

namespace App\Http\Controllers;

use App\Http\Resources\StoredFileResource;
use App\Models\Folder;
use App\Models\StoredFile;
use App\Services\TrashService;
use App\Support\StoragePath;
use App\Support\SyncHash;
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
            'mtime' => ['nullable', 'integer', 'min:0'],
        ]);

        $folder = null;
        if (! empty($validated['folder_id'])) {
            $folder = Folder::where('user_id', $request->user()->id)
                ->findOrFail($validated['folder_id']);
        }

        $uploaded = $request->file('file');
        $uuid = (string) Str::uuid();
        $extension = strtolower($uploaded->getClientOriginalExtension() ?: 'bin');
        $path = StoragePath::file($uuid, $extension);
        Storage::disk('public')->putFileAs(dirname($path), $uploaded, basename($path));

        $ttl = $folder?->default_ttl_days ?? $request->user()->default_file_ttl_days;
        $mtime = isset($validated['mtime']) ? (int) $validated['mtime'] : now()->getTimestamp();

        $file = $request->user()->files()->create([
            'folder_id' => $folder?->id,
            'uuid' => $uuid,
            'name' => $uploaded->getClientOriginalName(),
            'filename' => "{$uuid}.{$extension}",
            'mime_type' => $uploaded->getMimeType(),
            'size' => $uploaded->getSize(),
            'path' => $path,
            'mtime' => $mtime,
            'entry_hash' => SyncHash::file($uploaded->getClientOriginalName(), (int) $uploaded->getSize(), $mtime),
            'expires_at' => $ttl ? now()->addDays($ttl) : null,
        ]);

        SyncHash::refreshFolderChain($folder, $request->user());

        return (new StoredFileResource($file))->response()->setStatusCode(201);
    }

    /**
     * Приём одного чанка большого файла. Когда все части на месте —
     * собирает их в финальный файл и создаёт запись StoredFile.
     */
    public function storeChunk(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'upload_id' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{8,64}$/'],
            'index' => ['required', 'integer', 'min:0'],
            'total' => ['required', 'integer', 'min:1', 'max:4096'],
            'name' => ['required', 'string', 'max:255'],
            'folder_id' => ['nullable', 'integer'],
            'mtime' => ['nullable', 'integer', 'min:0'],
            'file' => ['required', 'file', 'max:16384'],
        ]);

        $dir = "chunks/{$request->user()->id}/{$validated['upload_id']}";
        $request->file('file')->storeAs($dir, "{$validated['index']}.part");

        $received = count(Storage::files($dir));
        if ($received < (int) $validated['total']) {
            return response()->json(['ok' => true, 'received' => $received]);
        }

        $folder = null;
        if (! empty($validated['folder_id'])) {
            $folder = Folder::where('user_id', $request->user()->id)
                ->findOrFail($validated['folder_id']);
        }

        $uuid = (string) Str::uuid();
        $extension = strtolower(pathinfo($validated['name'], PATHINFO_EXTENSION) ?: 'bin');
        $path = StoragePath::file($uuid, $extension);

        $tmp = fopen('php://temp', 'w+b');
        for ($i = 0; $i < (int) $validated['total']; $i++) {
            $part = Storage::readStream("{$dir}/{$i}.part");
            abort_if($part === false, 500, "Missing chunk {$i}");
            stream_copy_to_stream($part, $tmp);
            fclose($part);
        }
        rewind($tmp);
        Storage::disk('public')->put($path, $tmp);
        fclose($tmp);
        Storage::deleteDirectory($dir);

        $ttl = $folder?->default_ttl_days ?? $request->user()->default_file_ttl_days;
        $mtime = isset($validated['mtime']) ? (int) $validated['mtime'] : now()->getTimestamp();
        $size = Storage::disk('public')->size($path);

        $file = $request->user()->files()->create([
            'folder_id' => $folder?->id,
            'uuid' => $uuid,
            'name' => $validated['name'],
            'filename' => "{$uuid}.{$extension}",
            'mime_type' => Storage::disk('public')->mimeType($path),
            'size' => $size,
            'path' => $path,
            'mtime' => $mtime,
            'entry_hash' => SyncHash::file($validated['name'], (int) $size, $mtime),
            'expires_at' => $ttl ? now()->addDays($ttl) : null,
        ]);

        SyncHash::refreshFolderChain($folder, $request->user());

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

        $oldFolder = $file->folder;
        $nameChanged = isset($validated['name']) && $validated['name'] !== $file->name;
        $file->update($validated);

        // Переименование/перенос меняет entry_hash узла и dir_hash веток.
        if ($nameChanged) {
            $file->refreshEntryHash();
            $file->saveQuietly();
        }
        if ($nameChanged || $file->folder_id !== $oldFolder?->id) {
            SyncHash::refreshFolderChain($file->folder, $request->user());
            SyncHash::refreshFolderChain($oldFolder, $request->user());
        }

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

    /**
     * Удаление — в корзину (soft-delete). Физический файл остаётся
     * на диске до автоочистки по users.trash_retention_days.
     */
    public function destroy(Request $request, StoredFile $file): JsonResponse
    {
        abort_unless($file->user_id === $request->user()->id, 403);

        app(TrashService::class)->trashFile($file);

        return response()->json(['message' => 'Moved to trash.']);
    }
}
