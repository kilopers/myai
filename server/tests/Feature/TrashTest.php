<?php

namespace Tests\Feature;

use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\ShareLink;
use App\Models\StoredFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class TrashTest extends TestCase
{
    use RefreshDatabase;

    private function makeFile(User $user, ?Folder $folder = null, array $attrs = []): StoredFile
    {
        return StoredFile::create(array_merge([
            'user_id' => $user->id,
            'folder_id' => $folder?->id,
            'uuid' => (string) Str::uuid(),
            'name' => 'doc.pdf',
            'filename' => 'doc.pdf',
            'mime_type' => 'application/pdf',
            'size' => 100,
            'path' => 'files/ab/cd/x.pdf',
            'mtime' => 1700000000,
        ], $attrs));
    }

    public function test_delete_file_goes_to_trash_and_keeps_physical_file(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Документы']);
        $file = $this->makeFile($user, $folder);
        Storage::disk('public')->put($file->path, 'data');

        ShareLink::create([
            'user_id' => $user->id,
            'token' => ShareLink::newToken(),
            'linkable_type' => StoredFile::class,
            'linkable_id' => $file->id,
        ]);

        $this->actingAs($user)->deleteJson("/api/files/{$file->id}")->assertOk();

        $file->refresh();
        $this->assertNotNull($file->deleted_at);
        $this->assertSame('Документы/doc.pdf', $file->original_path);
        Storage::disk('public')->assertExists($file->path);
        $this->assertDatabaseMissing('share_links', ['linkable_id' => $file->id]);
        $this->assertDatabaseHas('deleted_files', [
            'kind' => 'file',
            'name' => 'doc.pdf',
            'dir_path' => 'Документы',
            'entry_hash' => $file->entryHash(),
        ]);
    }

    public function test_trash_index_lists_files_and_screenshots(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user);
        $shot = Screenshot::create([
            'user_id' => $user->id,
            'uuid' => (string) Str::uuid(),
            'filename' => 'abc.png',
            'mime_type' => 'image/png',
            'size' => 10,
            'path' => 'files/aa/bb/abc.png',
        ]);

        $this->actingAs($user)->deleteJson("/api/files/{$file->id}")->assertOk();
        $this->actingAs($user)->deleteJson("/api/screenshots/{$shot->uuid}")->assertOk();

        $all = $this->actingAs($user)->getJson('/api/trash')->assertOk();
        $this->assertCount(1, $all->json('files'));
        $this->assertCount(1, $all->json('screenshots'));

        $onlyFiles = $this->actingAs($user)->getJson('/api/trash?type=file')->assertOk();
        $this->assertCount(1, $onlyFiles->json('files'));
        $this->assertArrayNotHasKey('screenshots', $onlyFiles->json());
    }

    public function test_restore_recreates_folder_chain_and_resolves_name_collision(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $root = Folder::create(['user_id' => $user->id, 'name' => 'a']);
        $child = Folder::create(['user_id' => $user->id, 'name' => 'b', 'parent_id' => $root->id]);
        $file = $this->makeFile($user, $child);

        $this->actingAs($user)->deleteJson("/api/folders/{$root->id}")->assertOk();
        // Цепочка a/b удалена вместе с файлом
        $this->assertSame('a/b/doc.pdf', $file->fresh()->original_path);

        // Новый файл с тем же именем в пересозданной папке → суффикс (1)
        $newRoot = Folder::create(['user_id' => $user->id, 'name' => 'a']);
        $newChild = Folder::create(['user_id' => $user->id, 'name' => 'b', 'parent_id' => $newRoot->id]);
        $this->makeFile($user, $newChild);

        $this->actingAs($user)->postJson("/api/trash/file/{$file->id}/restore")->assertOk();

        $file->refresh();
        $this->assertNull($file->deleted_at);
        $this->assertSame($newChild->id, $file->folder_id);
        $this->assertSame('doc (1).pdf', $file->name);
    }

    public function test_restore_recreates_missing_folder_chain(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $root = Folder::create(['user_id' => $user->id, 'name' => 'x']);
        $file = $this->makeFile($user, $root);

        $this->actingAs($user)->deleteJson("/api/folders/{$root->id}")->assertOk();
        $this->assertSame(0, Folder::count());

        $this->actingAs($user)->postJson("/api/trash/file/{$file->id}/restore")->assertOk();

        $file->refresh();
        $this->assertNotNull($file->folder_id);
        $this->assertSame('x', $file->folder->name);
        $this->assertSame('doc.pdf', $file->name);
    }

    public function test_permanent_delete_removes_physical_file(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user);
        Storage::disk('public')->put($file->path, 'data');

        $this->actingAs($user)->deleteJson("/api/files/{$file->id}")->assertOk();
        $this->actingAs($user)->deleteJson("/api/trash/file/{$file->id}")->assertOk();

        $this->assertDatabaseMissing('files', ['id' => $file->id]);
        Storage::disk('public')->assertMissing($file->path);
    }

    public function test_clear_trash_purges_everything(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user);
        Storage::disk('public')->put($file->path, 'data');

        $this->actingAs($user)->deleteJson("/api/files/{$file->id}")->assertOk();
        $this->actingAs($user)->deleteJson('/api/trash')->assertOk();

        $this->assertDatabaseMissing('files', ['user_id' => $user->id]);
        Storage::disk('public')->assertMissing($file->path);
    }

    public function test_screenshot_delete_and_restore(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $shot = Screenshot::create([
            'user_id' => $user->id,
            'uuid' => (string) Str::uuid(),
            'filename' => 's.png',
            'mime_type' => 'image/png',
            'size' => 10,
            'path' => 'files/aa/bb/s.png',
        ]);

        $this->actingAs($user)->deleteJson("/api/screenshots/{$shot->uuid}")->assertOk();
        $this->assertSame('Скриншоты/s.png', $shot->fresh()->original_path);
        $this->assertDatabaseHas('deleted_files', ['kind' => 'screenshot', 'name' => 's.png']);

        $this->actingAs($user)->postJson("/api/trash/screenshot/{$shot->uuid}/restore")->assertOk();
        $this->assertNull($shot->fresh()->deleted_at);
    }

    public function test_system_screenshots_folder_cannot_be_deleted_or_renamed(): void
    {
        $user = User::factory()->create();
        $sys = Folder::screenshotsFolder($user);

        $this->actingAs($user)->deleteJson("/api/folders/{$sys->id}")->assertStatus(422);
        $this->actingAs($user)->putJson("/api/folders/{$sys->id}", ['name' => 'Другое'])->assertStatus(422);
        $this->actingAs($user)->putJson("/api/folders/{$sys->id}", ['default_ttl_days' => 7])->assertOk();
    }
}
