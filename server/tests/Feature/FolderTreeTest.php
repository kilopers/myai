<?php

namespace Tests\Feature;

use App\Models\Folder;
use App\Models\StoredFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FolderTreeTest extends TestCase
{
    use RefreshDatabase;

    public function test_nested_folder_create_state_and_breadcrumbs(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $root = $this->actingAs($user)->postJson('/api/action', [
            'action' => 'folders.create',
            'name' => 'Документы',
        ])->assertOk();

        $rootId = $root->json('result.data.id');

        $child = $this->actingAs($user)->postJson('/api/action', [
            'action' => 'folders.create',
            'name' => 'Счета',
            'parent_id' => $rootId,
        ])->assertOk();

        $childId = $child->json('result.data.id');

        $this->assertDatabaseHas('folders', ['id' => $childId, 'parent_id' => $rootId]);

        $state = $this->actingAs($user)->postJson('/api/action', [
            'action' => 'files.state',
            'folder_id' => $rootId,
        ])->assertOk();

        $this->assertCount(1, $state->json('state.folders'));
        $this->assertSame('Счета', $state->json('state.folders.0.name'));

        $nested = $this->actingAs($user)->postJson('/api/action', [
            'action' => 'files.state',
            'folder_id' => $childId,
        ])->assertOk();

        $this->assertSame(['Документы', 'Счета'], array_column($nested->json('state.breadcrumbs'), 'name'));
    }

    public function test_parent_folder_must_belong_to_user(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();
        $foreign = Folder::create(['user_id' => $other->id, 'name' => 'Чужая']);

        $this->actingAs($user)->postJson('/api/action', [
            'action' => 'folders.create',
            'name' => 'Подпапка',
            'parent_id' => $foreign->id,
        ])->assertStatus(422);
    }

    public function test_delete_folder_moves_children_files_to_trash(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $root = Folder::create(['user_id' => $user->id, 'name' => 'root']);
        $child = Folder::create(['user_id' => $user->id, 'name' => 'child', 'parent_id' => $root->id]);
        $file = StoredFile::create([
            'user_id' => $user->id,
            'folder_id' => $child->id,
            'uuid' => (string) Str::uuid(),
            'name' => 'a.txt',
            'filename' => 'a.txt',
            'mime_type' => 'text/plain',
            'size' => 3,
            'path' => 'files/a.txt',
        ]);
        Storage::disk('public')->put('files/a.txt', 'abc');

        $this->actingAs($user)->postJson('/api/action', [
            'action' => 'folders.delete',
            'id' => $root->id,
        ])->assertOk();

        // Всё ушло в корзину: записи помечены deleted_at, файл на диске остался
        $this->assertSoftDeleted('folders', ['id' => $root->id]);
        $this->assertSoftDeleted('folders', ['id' => $child->id]);
        $this->assertSoftDeleted('files', ['id' => $file->id]);
        $this->assertSame('root/child/a.txt', $file->fresh()->original_path);
        Storage::disk('public')->assertExists('files/a.txt');

        // Tombstone-лог для синхронизации
        $this->assertDatabaseHas('deleted_files', ['kind' => 'file', 'name' => 'a.txt', 'dir_path' => 'root/child']);
        $this->assertDatabaseHas('deleted_files', ['kind' => 'folder', 'name' => 'root']);
    }
}
