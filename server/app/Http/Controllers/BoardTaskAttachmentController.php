<?php

namespace App\Http\Controllers;

use App\Models\BoardTask;
use App\Models\BoardTaskAttachment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
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

        $attachment = BoardTaskAttachment::fromUpload($request->file('file'), $request->user()->id);
        $attachment->board_task_id = $task->id;
        $attachment->save();

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
