<?php

namespace App\Http\Controllers;

use App\Models\DeletedFile;
use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\StoredFile;
use App\Services\TrashService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TrashController extends Controller
{
    public function __construct(private TrashService $trash) {}

    /**
     * Содержимое корзины: файлы и скриншоты раздельно (?type=file|screenshot).
     */
    public function index(Request $request): JsonResponse
    {
        $type = $request->query('type');
        $userId = $request->user()->id;
        $data = [];

        if ($type === null || $type === 'file') {
            $data['files'] = StoredFile::onlyTrashed()
                ->where('user_id', $userId)
                ->latest('deleted_at')
                ->get()
                ->map(fn (StoredFile $f) => [
                    'id' => $f->id,
                    'name' => $f->name,
                    'original_path' => $f->original_path,
                    'size' => $f->size,
                    'deleted_at' => $f->deleted_at->toIso8601String(),
                ])->values();
        }

        if ($type === null || $type === 'screenshot') {
            $data['screenshots'] = Screenshot::onlyTrashed()
                ->where('user_id', $userId)
                ->latest('deleted_at')
                ->get()
                ->map(fn (Screenshot $s) => [
                    'id' => $s->uuid,
                    'name' => $s->filename,
                    'original_path' => $s->original_path,
                    'size' => $s->size,
                    'deleted_at' => $s->deleted_at->toIso8601String(),
                    'url' => $s->publicUrl(),
                ])->values();
        }

        return response()->json($data);
    }

    /**
     * Журнал удалений: tombstone-записи deleted_files (хранятся 6 месяцев).
     */
    public function log(Request $request): JsonResponse
    {
        $entries = DeletedFile::where('user_id', $request->user()->id)
            ->latest('deleted_at')
            ->limit(500)
            ->get()
            ->map(fn (DeletedFile $d) => [
                'id' => $d->id,
                'kind' => $d->kind,
                'name' => $d->name,
                'dir_path' => $d->dir_path,
                'size' => $d->size,
                'deleted_at' => $d->deleted_at->toIso8601String(),
            ])->values();

        return response()->json(['entries' => $entries]);
    }

    public function restore(Request $request, string $type, string $id): JsonResponse
    {
        $model = $this->findTrashed($request, $type, $id);

        match (true) {
            $model instanceof StoredFile => $this->trash->restoreFile($model),
            $model instanceof Screenshot => $this->trash->restoreScreenshot($model),
            default => null,
        };

        return response()->json(['ok' => true]);
    }

    /**
     * Удалить из корзины насовсем: физический файл и запись.
     */
    public function destroy(Request $request, string $type, string $id): JsonResponse
    {
        $model = $this->findTrashed($request, $type, $id);

        match (true) {
            $model instanceof StoredFile => $this->trash->purgeFile($model),
            $model instanceof Screenshot => $this->trash->purgeScreenshot($model),
            $model instanceof Folder => $this->trash->purgeFolder($model),
            default => null,
        };

        return response()->json(['ok' => true]);
    }

    /**
     * Очистить корзину целиком (всё удалённое уходит насовсем).
     */
    public function clear(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        foreach (StoredFile::onlyTrashed()->where('user_id', $userId)->get() as $file) {
            $this->trash->purgeFile($file);
        }
        foreach (Screenshot::onlyTrashed()->where('user_id', $userId)->get() as $shot) {
            $this->trash->purgeScreenshot($shot);
        }
        foreach (Folder::onlyTrashed()->where('user_id', $userId)->get() as $folder) {
            $this->trash->purgeFolder($folder);
        }

        return response()->json(['ok' => true]);
    }

    private function findTrashed(Request $request, string $type, string $id): StoredFile|Screenshot|Folder
    {
        $userId = $request->user()->id;

        return match ($type) {
            'file' => StoredFile::onlyTrashed()->where('user_id', $userId)->findOrFail($id),
            'screenshot' => Screenshot::onlyTrashed()
                ->where('user_id', $userId)
                ->where(fn ($q) => $q->where('uuid', $id)->orWhere('id', $id))
                ->firstOrFail(),
            'folder' => Folder::onlyTrashed()->where('user_id', $userId)->findOrFail($id),
            default => abort(404),
        };
    }
}
