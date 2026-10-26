<?php

namespace App\Http\Controllers;

use App\Events\SyncRequested;
use App\Http\Requests\UploadScreenshotRequest;
use App\Http\Resources\ScreenshotResource;
use App\Http\Resources\StoredFileResource;
use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\ShareLink;
use App\Models\StoredFile;
use App\Support\SyncHash;
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
                'files.uploadChunk' => $this->fileUploadChunk($request),
                'files.delete' => $this->deleteModel(StoredFile::class, $request),
                'folders.create' => $this->folderCreate($request),
                'folders.delete' => $this->deleteModel(Folder::class, $request),
                'folders.setTtl' => $this->folderSetTtl($request),

                // Публичные ссылки
                'share.create' => $this->shareCreate($request),
                'share.delete' => $this->shareDelete($request),

                // Синхронизация: «Синхронизировать эту ветку» из дерева папок
                'sync.branch' => $this->syncBranch($request),

                // «Наблюдатель» директории: сверка хэша после реконнекта
                'dir.watch' => $this->dirWatch($request),

                default => throw new \InvalidArgumentException("Unknown action: {$action}"),
            };
        } catch (\InvalidArgumentException $e) {
            return response()->json(['ok' => false, 'error' => $e->getMessage()], 422);
        }

        return response()->json([
            'ok' => true,
            'result' => $result,
            'state' => $this->stateFor($request, $action, $result),
        ]);
    }

    /**
     * Состояние для ответа: у *.state-экшенов result и есть состояние
     * (не считаем повторно), у мутаций сбой состояния не должен
     * превращать успешную операцию в ошибку — логируем и отдаём null.
     */
    private function stateFor(Request $request, string $action, mixed $result): ?array
    {
        if (str($action)->endsWith('.state')) {
            return is_array($result) ? $result : null;
        }
        try {
            return $this->autoState($request, $action);
        } catch (\Throwable $e) {
            report($e);

            return null;
        }
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
            'dir_hash' => SyncHash::screenshotsHash($request->user()),
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
                Folder::where('user_id', $userId)->where('parent_id', $folder?->id)->withCount('files')->orderBy('name')->get()
            )->resolve(),
            'files' => StoredFileResource::collection(
                StoredFile::where('user_id', $userId)->where('folder_id', $folder?->id)->latest()->get()
            )->resolve(),
            'breadcrumbs' => $this->breadcrumbs($folder),
            'dir_hash' => $folder?->dirHash() ?? SyncHash::rootHash($request->user()),
        ];
    }

    /**
     * «Я смотрю эту директорию с таким хэшем» — сервер сверяет хэш с
     * актуальным и отвечает diverged; после реконнекта клиент ловит
     * пропущенные push-обновления. scope=screenshots — галерея.
     */
    private function dirWatch(Request $request): array
    {
        $user = $request->user();
        $clientHash = (string) $request->input('dir_hash', '');

        if ($request->input('scope') === 'screenshots') {
            $current = SyncHash::screenshotsHash($user);

            return ['diverged' => $clientHash !== '' && ! hash_equals($current, $clientHash), 'dir_hash' => $current];
        }

        $folderId = $request->input('folder_id');
        if ($folderId === null) {
            $current = SyncHash::rootHash($user);

            return ['diverged' => $clientHash !== '' && ! hash_equals($current, $clientHash), 'dir_hash' => $current];
        }

        $folder = Folder::where('user_id', $user->id)->find($folderId);
        if ($folder === null) {
            // Папка удалена/в корзине — клиенту надо перезагрузиться.
            return ['diverged' => true, 'gone' => true, 'dir_hash' => null];
        }

        $current = $folder->dirHash();

        return ['diverged' => $clientHash !== '' && ! hash_equals($current, $clientHash), 'dir_hash' => $current];
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

    private function fileUploadChunk(Request $request): JsonResponse
    {
        return app(FileController::class)->storeChunk($request);
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

    private function syncBranch(Request $request): array
    {
        $folderId = $request->input('folder_id');
        if ($folderId !== null) {
            Folder::where('user_id', $request->user()->id)->findOrFail($folderId);
        }
        event(new SyncRequested($request->user()->id, $folderId));

        return ['sent' => true, 'folder_id' => $folderId];
    }

    private function deleteModel(string $class, Request $request): array
    {
        $model = $class === Screenshot::class
            ? $class::where('user_id', $request->user()->id)
                ->where(fn ($q) => $q->where('uuid', $request->input('id'))->orWhere('id', $request->input('id')))
                ->firstOrFail()
            : $class::where('user_id', $request->user()->id)->findOrFail($request->input('id'));
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
