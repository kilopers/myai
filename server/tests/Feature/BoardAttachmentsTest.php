<?php

namespace Tests\Feature;

use App\Models\BoardTaskAttachment;
use App\Models\StoredFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class BoardAttachmentsTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{0: array, 1: array} — доска, задача */
    private function boardWithTask(User $user): array
    {
        $board = $this->actingAs($user)->postJson('/api/boards', ['name' => 'B'])
            ->assertCreated()->json();
        $column = $this->actingAs($user)->postJson('/api/board-columns', [
            'board_id' => $board['id'], 'name' => 'C',
        ])->assertCreated()->json();
        $task = $this->actingAs($user)->postJson('/api/board-tasks', [
            'board_column_id' => $column['id'], 'title' => 'T',
        ])->assertCreated()->json();

        return [$board, $task];
    }

    public function test_attachments_upload_serve_and_delete(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        [$board, $task] = $this->boardWithTask($user);

        // Фото → kind=photo, отдаётся инлайн
        $photo = $this->actingAs($user)->postJson('/api/board-task-attachments', [
            'board_task_id' => $task['id'],
            'file' => UploadedFile::fake()->image('shot.png', 40, 40),
        ])->assertCreated()->json();
        $this->assertSame('photo', $photo['kind']);
        $this->assertStringStartsWith('attachments/', $photo['path']);

        // Произвольный файл → kind=file
        $doc = $this->actingAs($user)->postJson('/api/board-task-attachments', [
            'board_task_id' => $task['id'],
            'file' => UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf'),
        ])->assertCreated()->json();
        $this->assertSame('file', $doc['kind']);

        // Вложения приезжают вместе с задачами доски
        $columns = $this->actingAs($user)
            ->getJson('/api/board-columns?board_id='.$board['id'])->assertOk()->json();
        $this->assertCount(2, $columns[0]['tasks'][0]['attachments']);

        // В файловом менеджере вложений нет
        $this->assertSame(0, StoredFile::count());
        $files = $this->actingAs($user)->getJson('/api/files')->assertOk()->json();
        $this->assertSame(0, $files['total'] ?? count($files['data'] ?? []));

        // Отдача — только владельцу
        $other = User::factory()->create();
        $this->actingAs($other)
            ->get('/api/board-task-attachments/'.$photo['id'])->assertForbidden();
        $this->actingAs($user)
            ->get('/api/board-task-attachments/'.$photo['id'])
            ->assertOk()->assertHeader('content-type', 'image/png');

        // Объём учитывается в сводке хранилища
        $summary = $this->actingAs($user)->getJson('/api/storage/summary')->assertOk()->json();
        $this->assertSame(2, $summary['attachments']['count']);
        $this->assertGreaterThan(0, $summary['attachments']['size']);

        // Удаление чистит файл с диска
        $path = $doc['path'];
        $this->actingAs($user)
            ->deleteJson('/api/board-task-attachments/'.$doc['id'])->assertNoContent();
        Storage::disk('public')->assertMissing($path);
    }

    public function test_task_delete_purges_attachment_files(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        [, $task] = $this->boardWithTask($user);

        $att = $this->actingAs($user)->postJson('/api/board-task-attachments', [
            'board_task_id' => $task['id'],
            'file' => UploadedFile::fake()->create('note.txt', 1, 'text/plain'),
        ])->assertCreated()->json();

        $this->actingAs($user)->deleteJson('/api/board-tasks/'.$task['id'])
            ->assertNoContent();
        Storage::disk('public')->assertMissing($att['path']);
        $this->assertSame(0, BoardTaskAttachment::count());
    }
}
