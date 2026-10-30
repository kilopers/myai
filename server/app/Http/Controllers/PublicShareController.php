<?php

namespace App\Http\Controllers;

use App\Models\FileDerivative;
use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\ShareLink;
use App\Models\StoredFile;
use App\Services\DirChangeTracker;
use App\Services\StoredFileWriter;
use App\Support\StoragePath;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Публичные ссылки. Старые урлы /f/{token} и /d/{token} редиректят в
 * SPA-страницы просмотра (/share/...), данные и контент отдаёт
 * /api/share/{token}/... — всё без авторизации, токен = ключ доступа.
 */
class PublicShareController extends Controller
{
    public function file(string $token): RedirectResponse
    {
        return redirect("/share/f/{$token}");
    }

    public function folder(string $token): RedirectResponse
    {
        return redirect("/share/d/{$token}");
    }

    public function folderFile(string $token, string $uuid): RedirectResponse
    {
        return redirect("/share/d/{$token}/file/{$uuid}");
    }

    /** Мета ссылки: для файла — сам файл, для папки — имя и список файлов. */
    public function info(string $token): JsonResponse
    {
        $link = $this->findLink($token);

        if ($link->linkable instanceof StoredFile) {
            return response()->json([
                'type' => 'file',
                'can_write' => false,
                'expires_at' => $link->expires_at?->toIso8601String(),
                'file' => $this->fileData($link->linkable),
            ]);
        }

        /** @var Folder $folder */
        $folder = $link->linkable;

        return response()->json([
            'type' => 'folder',
            'name' => $folder->name,
            'can_write' => (bool) $link->can_write,
            'expires_at' => $link->expires_at?->toIso8601String(),
            'files' => $folder->files()->latest()->limit(500)->get()
                ->map(fn (StoredFile $f) => $this->fileData($f))->all(),
        ]);
    }

    /** Мета одного файла по ссылке (файловая ссылка или файл внутри папки). */
    public function fileInfo(string $token, string $uuid): JsonResponse
    {
        return response()->json(['file' => $this->fileData($this->resolveFile($token, $uuid))]);
    }

    /** Оригинал файла инлайн (превью в просмотрщике). */
    public function raw(string $token, string $uuid): BinaryFileResponse
    {
        $file = $this->resolveFile($token, $uuid);
        abort_unless(Storage::disk('public')->exists($file->path), 404);

        return response()->file(Storage::disk('public')->path($file->path), [
            'Content-Type' => $file->mime_type ?: 'application/octet-stream',
        ]);
    }

    /** Скачать оригинал (Content-Disposition: attachment). */
    public function download(string $token, string $uuid): BinaryFileResponse
    {
        $file = $this->resolveFile($token, $uuid);
        abort_unless(Storage::disk('public')->exists($file->path), 404);

        return response()->download(Storage::disk('public')->path($file->path), $file->name);
    }

    public function thumbnail(string $token, string $uuid): BinaryFileResponse
    {
        $file = $this->resolveFile($token, $uuid);
        $derivative = $file->derivatives()
            ->whereIn('kind', [FileDerivative::KIND_THUMBNAIL, FileDerivative::KIND_POSTER])
            ->orderByRaw("kind = '".FileDerivative::KIND_POSTER."'")
            ->first();
        abort_if($derivative === null, 404);

        return $this->derivativeResponse($derivative);
    }

    public function pages(string $token, string $uuid): JsonResponse
    {
        $file = $this->resolveFile($token, $uuid);

        return response()->json([
            'count' => $file->derivatives()->where('kind', FileDerivative::KIND_PAGE)->count(),
        ]);
    }

    public function page(string $token, string $uuid, int $page): BinaryFileResponse
    {
        $file = $this->resolveFile($token, $uuid);
        $derivative = $file->derivatives()
            ->where('kind', FileDerivative::KIND_PAGE)
            ->where('page_number', $page)
            ->first();
        abort_if($derivative === null, 404);

        return $this->derivativeResponse($derivative);
    }

    /** Сконвертированная версия (mp4/pdf), HTTP Range — мотание в плеере. */
    public function converted(string $token, string $uuid): BinaryFileResponse
    {
        $file = $this->resolveFile($token, $uuid);
        $derivative = $file->derivatives()
            ->whereIn('kind', [FileDerivative::KIND_VIDEO, FileDerivative::KIND_PDF])
            ->orderByRaw("kind = '".FileDerivative::KIND_PDF."'")
            ->first();
        abort_if($derivative === null, 404);

        return $this->derivativeResponse($derivative);
    }

    /**
     * Загрузка в расшаренную папку — только по ссылке с «разрешить
     * загрузку» (can_write). Файл создаётся от имени владельца папки.
     */
    public function upload(Request $request, string $token): JsonResponse
    {
        $link = $this->findLink($token, Folder::class);
        abort_unless($link->can_write, 403);

        $validated = $request->validate([
            'file' => ['required', 'file', 'max:8388608'],
        ]);

        /** @var Folder $folder */
        $folder = $link->linkable;
        $owner = $folder->user;

        $uploaded = $request->file('file');
        $name = $uploaded->getClientOriginalName();
        abort_if(
            $folder->files()->where('name', $name)->exists(),
            422,
            "Файл «{$name}» уже есть в этой папке.",
        );

        $uuid = (string) Str::uuid();
        $extension = strtolower($uploaded->getClientOriginalExtension() ?: 'bin');
        $path = StoragePath::file($uuid, $extension);
        Storage::disk('public')->putFileAs(dirname($path), $uploaded, basename($path));

        $file = app(StoredFileWriter::class)->register($owner, $folder, [
            'uuid' => $uuid,
            'name' => $name,
            'filename' => "{$uuid}.{$extension}",
            'mime_type' => $uploaded->getMimeType(),
            'size' => (int) $uploaded->getSize(),
            'path' => $path,
            'mtime' => now()->getTimestamp(),
        ]);

        // Гость не проходит BroadcastDirChanges — сбрасываем накопленные
        // изменения владельцу вручную (живое обновление его клиентов).
        app(DirChangeTracker::class)->flushFor($owner);

        return response()->json(['file' => $this->fileData($file)], 201);
    }

    /** Мета скриншота для SPA-страницы /share/i/{uuid}. */
    public function screenshot(string $uuid): JsonResponse
    {
        $shot = Screenshot::where('uuid', $uuid)->firstOrFail();

        return response()->json([
            'name' => $shot->filename,
            'mime_type' => $shot->mime_type,
            'size' => $shot->size,
            'url' => $shot->publicUrl(),
        ]);
    }

    private function fileData(StoredFile $f): array
    {
        return [
            'uuid' => $f->uuid,
            'name' => $f->name,
            'mime_type' => $f->mime_type,
            'size' => $f->size,
            'conversion_status' => $f->conversion_status,
            'expires_at' => $f->expires_at?->toIso8601String(),
        ];
    }

    /**
     * Файл по uuid в рамках ссылки: для файловой — сверяем uuid,
     * для папочной — ищем внутри папки.
     */
    private function resolveFile(string $token, string $uuid): StoredFile
    {
        $link = $this->findLink($token);

        if ($link->linkable instanceof StoredFile) {
            abort_unless($link->linkable->uuid === $uuid, 404);

            return $link->linkable;
        }

        return $link->linkable->files()->where('uuid', $uuid)->firstOrFail();
    }

    private function derivativeResponse(FileDerivative $derivative): BinaryFileResponse
    {
        abort_unless(Storage::disk('public')->exists($derivative->path), 404);

        return response()->file(Storage::disk('public')->path($derivative->path), [
            'Content-Type' => $derivative->mime_type ?: 'application/octet-stream',
            'Cache-Control' => 'private, max-age=3600',
        ]);
    }

    private function findLink(string $token, ?string $type = null): ShareLink
    {
        $query = ShareLink::where('token', $token);
        if ($type !== null) {
            $query->where('linkable_type', $type);
        }
        $link = $query->firstOrFail();

        abort_if($link->isExpired(), 410);

        return $link;
    }
}
