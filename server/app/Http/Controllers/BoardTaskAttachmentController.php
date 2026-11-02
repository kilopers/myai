<?php

namespace App\Http\Controllers;

use App\Models\BoardTask;
use App\Models\BoardTaskAttachment;
use App\Support\StoragePath;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class BoardTaskAttachmentController extends Controller
{
    /**
     * Загрузка вложения: multipart file + board_task_id. kind выставляется
     * по mime: image/* → photo, остальное → file.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'board_task_id' => ['required', 'integer'],
            'file' => ['required', 'file', 'max:102400'],
        ]);

        $task = BoardTask::findOrFail($data['board_task_id']);
        abort_unless($task->column->board->user_id === $request->user()->id, 403);

        $uploaded = $request->file('file');
        $mime = $uploaded->getMimeType();
        $extension = strtolower($uploaded->getClientOriginalExtension() ?: 'bin');
        $uuid = (string) Str::uuid();
        $path = StoragePath::attachment($uuid, $extension);
        Storage::disk('public')->putFileAs(dirname($path), $uploaded, basename($path));

        $attachment = $task->attachments()->create([
            'user_id' => $request->user()->id,
            'uuid' => $uuid,
            'kind' => str_starts_with((string) $mime, 'image/') ? 'photo' : 'file',
            'name' => $uploaded->getClientOriginalName() ?: "file.{$extension}",
            'filename' => "{$uuid}.{$extension}",
            'mime_type' => $mime,
            'size' => $uploaded->getSize() ?: 0,
            'path' => $path,
        ]);

        return response()->json($attachment, 201);
    }

    /**
     * Отдача вложения: изображения инлайн (миниатюры в карточке/галерее),
     * остальные типы — скачиванием.
     */
    public function show(Request $request, BoardTaskAttachment $boardTaskAttachment): StreamedResponse
    {
        abort_unless($boardTaskAttachment->user_id === $request->user()->id, 403);
        abort_unless(Storage::disk('public')->exists($boardTaskAttachment->path), 404);

        $headers = ['Content-Type' => $boardTaskAttachment->mime_type ?? 'application/octet-stream'];
        $inline = $boardTaskAttachment->isPhoto();

        return Storage::disk('public')->response(
            $boardTaskAttachment->path,
            $boardTaskAttachment->name,
            $headers,
            $inline ? 'inline' : 'attachment',
        );
    }

    public function destroy(Request $request, BoardTaskAttachment $boardTaskAttachment)
    {
        abort_unless($boardTaskAttachment->user_id === $request->user()->id, 403);
        $boardTaskAttachment->deleteFile();

        return response()->noContent();
    }
}
