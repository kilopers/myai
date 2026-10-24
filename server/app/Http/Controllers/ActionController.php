<?php

namespace App\Http\Controllers;

use App\Http\Requests\UploadScreenshotRequest;
use App\Http\Resources\ScreenshotResource;
use App\Http\Resources\StoredFileResource;
use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\ShareLink;
use App\Models\StoredFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ActionController extends Controller
{
    /**
     * Единая точка входа веб-приложения: POST /api/action
     * Тело: {"action": "...", ...параметры}. Ответ: {"ok": true, "state": {...}}.
     */
    public function handle(Request $request): JsonResponse
    {
        $action = $request->input('action');
        $user = $request->user();

        try {
            $result = match ($action) {
                // Скриншоты
                'screenshots.state' => $this->screenshotsState($request),
                'screenshots.upload' => $this->screenshotUpload($request),
                'screenshots.delete' => $this->deleteModel(Screenshot::class, $request),

                // Файлы/папки
                'files.state' => $this->filesState($request),
                'files.upload' => $this->fileUpload($request),
                'files.delete' => $this->deleteModel(StoredFile::class, $request),
                'folders.create' => $this->folderCreate($request),
                'folders.delete' => $this->deleteModel(Folder::class, $request),
                'folders.setTtl' => $this->folderSetTtl($request),

                // Публичные ссылки
                'share.create' => $this->shareCreate($request),
                'share.delete' => $this->shareDelete($request),

                default => throw new \InvalidArgumentException("Unknown action: {$action}"),
            };
        } catch (\InvalidArgumentException $e) {
            return response()->json(['ok' => false, 'error' => $e->getMessage()], 422);
        }

        return response()->json([
            'ok' => true,
            'result' => $result,
            'state' => $this->autoState($request, $action),
        ]);
    }

    /** Авто-состояние после мутации — по префиксу экшена. */
    private function autoState(Request $request, string $action): ?array
    {
        return match (str($action)->before('.')->toString()) {
            'screenshots' => $this->screenshotsState($request),
            'files', 'folders', 'share' => $this->filesState($request),
            default => null,
        };
    }

    private function screenshotsState(Request $request): array
    {
        $shots = Screenshot::where('user_id', $request->user()->id)
            ->latest()->paginate(60);

        return [
            'screenshots' => ScreenshotResource::collection($shots)->resolve(),
            'meta' => ['page' => $shots->currentPage(), 'last_page' => $shots->lastPage(), 'total' => $shots->total()],
        ];
    }

    private function filesState(Request $request): array
    {
        $userId = $request->user()->id;
        $folderId = $request->input('folder_id');
        $folder = $folderId ? Folder::where('user_id', $userId)->findOrFail($folderId) : null;

        return [
            'folder' => $folder ? (new JsonResource($folder))->resolve() : null,
            'folders' => JsonResource::collection(
                Folder::where('user_id', $userId)->where('parent_id', $folder?->id)->orderBy('name')->get()
            )->resolve(),
            'files' => StoredFileResource::collection(
                StoredFile::where('user_id', $userId)->where('folder_id', $folder?->id)->latest()->get()
            )->resolve(),
            'breadcrumbs' => $this->breadcrumbs($folder),
        ];
    }

    private function breadcrumbs(?Folder $folder): array
    {
        $crumbs = [];
        while ($folder) {
            $crumbs[] = ['id' => $folder->id, 'name' => $folder->name];
            $folder = $folder->parent;
        }

        return array_reverse($crumbs);
    }

    private function screenshotUpload(Request $request): JsonResponse
    {
        return app(ScreenshotController::class)->store(
            UploadScreenshotRequest::createFrom($request)
        );
    }

    private function fileUpload(Request $request): JsonResponse
    {
        return app(FileController::class)->store($request);
    }

    private function folderCreate(Request $request): array
    {
        $res = app(FolderController::class)->store($request);

        return $res->getData(true);
    }

    private function folderSetTtl(Request $request): array
    {
        $folder = Folder::where('user_id', $request->user()->id)->findOrFail($request->input('id'));

        return ['folder' => app(FolderController::class)->update($request, $folder)->resolve()];
    }

    private function deleteModel(string $class, Request $request): array
    {
        $model = $class::where('user_id', $request->user()->id)->findOrFail($request->input('id'));
        $ctrl = match ($class) {
            Screenshot::class => ScreenshotController::class,
            StoredFile::class => FileController::class,
            Folder::class => FolderController::class,
        };
        if (! $request->input('id')) {
            throw new \InvalidArgumentException('id required');
        }
        $res = $class === Screenshot::class
            ? app($ctrl)->destroy($model)
            : app($ctrl)->destroy($request, $model);

        return $res->getData(true);
    }

    private function shareCreate(Request $request): array
    {
        return app(ShareLinkController::class)->store($request)->getData(true);
    }

    private function shareDelete(Request $request): array
    {
        $link = ShareLink::where('user_id', $request->user()->id)->findOrFail($request->input('id'));

        return app(ShareLinkController::class)->destroy($request, $link)->getData(true);
    }
}
