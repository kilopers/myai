<?php

namespace Tests\Feature;

use App\Models\Note;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotesTest extends TestCase
{
    use RefreshDatabase;

    public function test_notes_folders_and_notes_crud(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();

        // Папка
        $folder = $this->actingAs($user)->postJson('/api/note-folders', ['name' => 'Работа'])
            ->assertCreated()->json('data');
        $this->assertSame('Работа', $folder['name']);

        // Заметка с HTML-текстом в папке
        $note = $this->actingAs($user)->postJson('/api/notes', [
            'note_folder_id' => $folder['id'],
            'title' => 'Первая',
            'text' => '<p>Привет <b>мир</b></p>',
        ])->assertCreated()->json('data');
        $this->assertSame('Первая', $note['title']);
        $this->assertSame($folder['id'], $note['note_folder_id']);

        // Индекс: все заметки и фильтр по папке
        $this->actingAs($user)->postJson('/api/notes', ['title' => 'Вне папки'])
            ->assertCreated();
        $all = $this->actingAs($user)->getJson('/api/notes')->assertOk()->json('data');
        $this->assertCount(2, $all);
        $inFolder = $this->actingAs($user)->getJson('/api/notes?note_folder_id='.$folder['id'])
            ->assertOk()->json('data');
        $this->assertCount(1, $inFolder);
        // Поиск по заголовку
        $found = $this->actingAs($user)->getJson('/api/notes?q=Перв')->assertOk()->json('data');
        $this->assertCount(1, $found);

        // Правка текста/заголовка
        $upd = $this->actingAs($user)->putJson('/api/notes/'.$note['id'], [
            'title' => 'Первая*', 'text' => '<p>новый</p>',
        ])->assertOk()->json('data');
        $this->assertSame('Первая*', $upd['title']);
        $this->assertSame('<p>новый</p>', $upd['text']);

        // Чужая заметка/папка — 403; чужая папка при создании — 422
        $this->actingAs($other)->putJson('/api/notes/'.$note['id'], ['title' => 'x'])
            ->assertForbidden();
        $this->actingAs($other)->postJson('/api/notes', [
            'note_folder_id' => $folder['id'], 'title' => 'x',
        ])->assertUnprocessable();
        $this->actingAs($other)->deleteJson('/api/note-folders/'.$folder['id'])
            ->assertForbidden();

        // Удаление папки каскадно сносит её заметки
        $this->actingAs($user)->deleteJson('/api/notes/'.$note['id'])->assertOk();
        $this->actingAs($user)->deleteJson('/api/note-folders/'.$folder['id'])->assertOk();
        // «Вне папки» осталась — она не входила в удалённую папку
        $this->assertSame(1, Note::count());
    }
}
