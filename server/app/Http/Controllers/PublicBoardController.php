<?php

namespace App\Http\Controllers;

use App\Models\Board;
use App\Models\BoardColumn;
use App\Models\BoardTask;
use App\Models\BoardTaskAttachment;
use App\Models\BoardTaskComment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Публичная доска по share_token: полный функционал для гостя —
 * колонки, задачи, вложения, обсуждение. Токен — единственный ключ
 * доступа, поэтому каждый метод проверяет принадлежность сущности
 * доске с этим токеном.
 */
class PublicBoardController extends Controller
{
    private function board(string $token): Board
    {
        return Board::where('share_token', $token)->firstOrFail();
    }

    private function column(string $token, int $columnId): BoardColumn
    {
        $column = BoardColumn::findOrFail($columnId);
        abort_unless($column->board->share_token === $token, 404);

        return $column;
    }

    private function task(string $token, int $taskId): BoardTask
    {
        $task = BoardTask::findOrFail($taskId);
        abort_unless($task->column->board->share_token === $token, 404);

        return $task;
    }

    private function attachment(string $token, int $attachmentId): BoardTaskAttachment
    {
        $attachment = BoardTaskAttachment::findOrFail($attachmentId);
        abort_unless($attachment->task?->column->board->share_token === $token, 404);

        return $attachment;
    }

    /** Доска с колонками и задачами (вложения — для диалога задачи). */
    public function show(string $token): JsonResponse
    {
        $board = $this->board($token);

        return response()->json([
            'board' => array_merge($board->only('id', 'name', 'prefix'), [
                'guest_permissions' => [
                    'columns' => $board->guestCan('columns'),
                    'tasks' => $board->guestCan('tasks'),
                    'delete_tasks' => $board->guestCan('delete_tasks'),
                ],
            ]),
            'columns' => $board->columns()->with([
                'tasks.attachments',
                'tasks' => fn ($q) => $q->withCount(['comments', 'attachments']),
            ])->get(),
        ]);
    }

    public function storeColumn(Request $request, string $token): JsonResponse
    {
        $board = $this->board($token);
        abort_unless($board->guestCan('columns'), 403);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'color' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ]);

        $column = $board->columns()->create([
            'name' => $data['name'],
            'color' => $data['color'] ?? '#526de3',
            'position' => (int) $board->columns()->max('position') + 1,
        ]);

        return response()->json(
            $column->load(['tasks.attachments', 'tasks' => fn ($q) => $q->withCount('comments')]),
            201,
        );
    }

    public function updateColumn(Request $request, string $token, int $columnId): JsonResponse
    {
        $column = $this->column($token, $columnId);

        $column->update($request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'color' => ['sometimes', 'required', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ]));

        return response()->json($column);
    }

    public function destroyColumn(string $token, int $columnId): Response
    {
        $column = $this->column($token, $columnId);
        $column->tasks->each(fn ($task) => $task->attachments->each->deleteFile());
        $column->delete();

        return response()->noContent();
    }

    /** Сортировка задач внутри колонки: position = индекс в списке id. */
    public function reorderTasks(Request $request, string $token, int $columnId): Response
    {
        $column = $this->column($token, $columnId);

        $data = $request->validate([
            'task_ids' => ['required', 'array'],
            'task_ids.*' => ['integer'],
        ]);

        $tasks = $column->tasks()->whereIn('id', $data['task_ids'])->get()->keyBy('id');
        foreach ($data['task_ids'] as $i => $id) {
            if (isset($tasks[$id])) {
                $tasks[$id]->update(['position' => $i]);
            }
        }

        return response()->noContent();
    }

    public function storeTask(Request $request, string $token): JsonResponse
    {
        $board = $this->board($token);
        abort_unless($board->guestCan('tasks'), 403);

        $data = $request->validate([
            'board_column_id' => ['required', 'integer'],
            'title' => ['required', 'string', 'max:200'],
            'text' => ['nullable', 'string'],
        ]);

        $column = $this->column($token, (int) $data['board_column_id']);

        $column->tasks()->increment('position');

        $task = $column->tasks()->create([
            'title' => $data['title'],
            'text' => $data['text'] ?? null,
            'position' => 0,
            'number' => $board->next_task_number,
        ]);
        $board->increment('next_task_number');

        return response()->json($task, 201);
    }

    public function updateTask(Request $request, string $token, int $taskId): JsonResponse
    {
        $task = $this->task($token, $taskId);

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:200'],
            'text' => ['nullable', 'string'],
            'board_column_id' => ['sometimes', 'integer'],
            'position' => ['sometimes', 'integer', 'min:0'],
        ]);

        if (isset($data['board_column_id'])) {
            $target = $this->column($token, (int) $data['board_column_id']);
            if (! array_key_exists('position', $data)) {
                $data['position'] = (int) $target->tasks()->max('position') + 1;
            }
        }

        $task->update($data);

        return response()->json($task);
    }

    public function destroyTask(string $token, int $taskId): Response
    {
        $task = $this->task($token, $taskId);
        abort_unless($task->column->board->guestCan('delete_tasks'), 403);
        $task->attachments->each->deleteFile();
        $task->delete();

        return response()->noContent();
    }

    /** Вложение задачи гостем: файл пишется от имени владельца доски. */
    public function storeAttachment(Request $request, string $token): JsonResponse
    {
        $board = $this->board($token);

        $data = $request->validate([
            'board_task_id' => ['required', 'integer'],
            'file' => ['required', 'file', 'max:102400'],
        ]);

        $task = $this->task($token, (int) $data['board_task_id']);

        $attachment = BoardTaskAttachment::fromUpload($request->file('file'), $board->user_id);
        $attachment->board_task_id = $task->id;
        $attachment->save();

        return response()->json($attachment, 201);
    }

    /** Отдача вложения гостю — как у владельца: фото инлайн, файл скачиванием. */
    public function showAttachment(string $token, int $attachmentId): StreamedResponse
    {
        $attachment = $this->attachment($token, $attachmentId);
        abort_unless(Storage::disk('public')->exists($attachment->path), 404);

        return Storage::disk('public')->response(
            $attachment->path,
            $attachment->name,
            ['Content-Type' => $attachment->mime_type ?? 'application/octet-stream'],
            $attachment->isPhoto() ? 'inline' : 'attachment',
        );
    }

    public function destroyAttachment(string $token, int $attachmentId): Response
    {
        $attachment = $this->attachment($token, $attachmentId);
        $attachment->deleteFile();

        return response()->noContent();
    }

    public function comments(Request $request, string $token): JsonResponse
    {
        $task = $this->task($token, $request->integer('board_task_id'));

        return response()->json(
            $task->comments()->with(['user:id,name', 'attachments'])->get()
        );
    }

    /** Комментарий гостя: текст и/или files[], автор — guest_name. */
    public function storeComment(Request $request, string $token): JsonResponse
    {
        $board = $this->board($token);

        $data = $request->validate([
            'board_task_id' => ['required', 'integer'],
            'guest_name' => ['required', 'string', 'max:120'],
            'text' => ['nullable', 'string', 'max:2000'],
            'files' => ['nullable', 'array', 'max:10'],
            'files.*' => ['file', 'max:102400'],
        ]);

        $task = $this->task($token, (int) $data['board_task_id']);

        $text = trim((string) ($data['text'] ?? ''));
        $files = $request->file('files') ?? [];
        abort_if($text === '' && $files === [], 422, 'Пустой комментарий');

        $comment = $task->comments()->create([
            'user_id' => null,
            'guest_name' => trim($data['guest_name']),
            'text' => $text === '' ? null : $text,
        ]);

        foreach ($files as $file) {
            $attachment = BoardTaskAttachment::fromUpload($file, $board->user_id);
            $attachment->board_task_id = $task->id;
            $attachment->board_task_comment_id = $comment->id;
            $attachment->save();
        }

        return response()->json($comment->load(['user:id,name', 'attachments']), 201);
    }

    /** Гость удаляет только свой комментарий — сверяем имя. */
    public function destroyComment(Request $request, string $token, int $commentId): Response
    {
        $comment = BoardTaskComment::findOrFail($commentId);
        abort_unless($comment->task->column->board->share_token === $token, 404);
        abort_unless(
            $comment->guest_name !== null
                && $comment->guest_name === trim((string) $request->input('guest_name', '')),
            403,
        );

        $comment->attachments->each->deleteFile();
        $comment->delete();

        return response()->noContent();
    }
}
