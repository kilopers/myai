<?php

namespace App\Http\Controllers;

use App\Models\BoardTask;
use App\Models\BoardTaskAttachment;
use App\Models\BoardTaskComment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BoardTaskCommentController extends Controller
{
    /** Комментарии задачи с автором и вложениями, по времени. */
    public function index(Request $request): JsonResponse
    {
        $task = BoardTask::findOrFail($request->integer('board_task_id'));
        abort_unless($task->column->board->user_id === $request->user()->id, 403);

        $comments = $task->comments()
            ->with(['user:id,name', 'attachments'])
            ->get();

        return response()->json($comments);
    }

    /**
     * Новый комментарий: JSON или multipart. Текст необязателен,
     * если приложены файлы (files[] — фото и произвольные файлы).
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'board_task_id' => ['required', 'integer'],
            'text' => ['nullable', 'string', 'max:2000'],
            'files' => ['nullable', 'array', 'max:10'],
            'files.*' => ['file', 'max:102400'],
        ]);

        $task = BoardTask::findOrFail($data['board_task_id']);
        abort_unless($task->column->board->user_id === $request->user()->id, 403);

        $text = trim((string) ($data['text'] ?? ''));
        $files = $request->file('files') ?? [];
        abort_if($text === '' && $files === [], 422, 'Пустой комментарий');

        $comment = $task->comments()->create([
            'user_id' => $request->user()->id,
            'text' => $text === '' ? null : $text,
        ]);

        foreach ($files as $file) {
            $attachment = BoardTaskAttachment::fromUpload($file, $request->user()->id);
            $attachment->board_task_id = $task->id;
            $attachment->board_task_comment_id = $comment->id;
            $attachment->save();
        }

        return response()->json($comment->load(['user:id,name', 'attachments']), 201);
    }

    public function destroy(Request $request, BoardTaskComment $boardTaskComment)
    {
        abort_unless($boardTaskComment->user_id === $request->user()->id, 403);
        $boardTaskComment->attachments->each->deleteFile();
        $boardTaskComment->delete();

        return response()->noContent();
    }
}
