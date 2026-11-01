<?php

namespace Tests\Feature;

use App\Events\SyncRequested;
use App\Models\DeletedFile;
use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\StoredFile;
use App\Models\User;
use App\Support\SyncHash;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class SyncApiTest extends TestCase
{
    use RefreshDatabase;

    private function file(User $user, ?Folder $folder, string $name, int $size, int $mtime): StoredFile
    {
        return StoredFile::create([
            'user_id' => $user->id,
            'folder_id' => $folder?->id,
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'filename' => $name,
            'mime_type' => 'text/plain',
            'size' => $size,
            'path' => 'files/ab/cd/'.Str::uuid().'.txt',
            'mtime' => $mtime,
            'entry_hash' => SyncHash::file($name, $size, $mtime),
        ]);
    }

    public function test_tree_returns_folders_entries_tombstones_and_root_hash(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Документы']);
        $file = $this->file($user, $folder, 'a.txt', 3, 100);
        $shot = Screenshot::create([
            'user_id' => $user->id,
            'uuid' => (string) Str::uuid(),
            'filename' => 's.png',
            'mime_type' => 'image/png',
            'size' => 10,
            'path' => 'files/aa/bb/s.png',
            'mtime' => 50,
        ]);
        DeletedFile::create([
            'user_id' => $user->id,
            'kind' => 'file',
            'name' => 'gone.txt',
            'size' => 1,
            'mtime' => 1,
            'entry_hash' => SyncHash::file('gone.txt', 1, 1),
            'dir_path' => '',
            'deleted_at' => now(),
        ]);

        $r = $this->actingAs($user)->getJson('/api/sync/tree')->assertOk();

        $folders = collect($r->json('folders'));
        $this->assertNull($folders->firstWhere('is_system', true));

        $docs = $folders->firstWhere('name', 'Документы');
        $this->assertSame('Документы', $docs['path']);

        $entries = collect($r->json('entries'));
        $this->assertSame('a.txt', $entries->firstWhere('kind', 'file')['name']);
        // Скриншоты не синхронизируются — в дереве их нет
        $this->assertNull($entries->firstWhere('kind', 'screenshot'));

        $this->assertSame('gone.txt', $r->json('deleted.0.name'));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $r->json('root_hash'));
    }

    public function test_tree_excludes_trashed_items(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->file($user, null, 'keep.txt', 1, 1);
        $gone = $this->file($user, null, 'gone.txt', 1, 1);

        $this->actingAs($user)->deleteJson("/api/files/{$gone->id}")->assertOk();

        $entries = collect($this->actingAs($user)->getJson('/api/sync/tree')->json('entries'));
        $this->assertCount(1, $entries);
        $this->assertSame('keep.txt', $entries->first()['name']);
    }

    public function test_root_hash_changes_with_tree(): void
    {
        $user = User::factory()->create();
        $r1 = $this->actingAs($user)->getJson('/api/sync/tree')->json('root_hash');

        $this->file($user, null, 'a.txt', 3, 100);
        $r2 = $this->actingAs($user)->getJson('/api/sync/tree')->json('root_hash');

        $this->assertNotSame($r1, $r2);

        // Детерминировано: повторный запрос — тот же хэш
        $r3 = $this->actingAs($user)->getJson('/api/sync/tree')->json('root_hash');
        $this->assertSame($r2, $r3);
    }

    public function test_deleted_endpoint_filters_by_since(): void
    {
        $user = User::factory()->create();
        DeletedFile::create([
            'user_id' => $user->id, 'kind' => 'file', 'name' => 'old.txt', 'size' => 1,
            'entry_hash' => str_repeat('a', 64), 'dir_path' => '',
            'deleted_at' => now()->subDays(10),
        ]);
        DeletedFile::create([
            'user_id' => $user->id, 'kind' => 'file', 'name' => 'new.txt', 'size' => 1,
            'entry_hash' => str_repeat('b', 64), 'dir_path' => '',
            'deleted_at' => now(),
        ]);

        $all = $this->actingAs($user)->getJson('/api/sync/deleted')->assertOk();
        $this->assertCount(2, $all->json('deleted'));

        $since = $this->actingAs($user)
            ->getJson('/api/sync/deleted?since='.now()->subDay()->getTimestamp())
            ->assertOk();
        $this->assertCount(1, $since->json('deleted'));
        $this->assertSame('new.txt', $since->json('deleted.0.name'));
    }

    public function test_sync_excluded_folder_leaves_sync_tree_and_hashes(): void
    {
        $user = User::factory()->create();
        $docs = Folder::create(['user_id' => $user->id, 'name' => 'Документы']);
        $big = Folder::create(['user_id' => $user->id, 'name' => 'Архив']);
        $nested = Folder::create(['user_id' => $user->id, 'name' => 'Вложенная', 'parent_id' => $big->id]);
        $this->file($user, $docs, 'a.txt', 3, 100);
        $this->file($user, $big, 'huge.bin', 9, 200);
        $this->file($user, $nested, 'deep.bin', 5, 300);

        $hashAll = $this->actingAs($user)->getJson('/api/sync/tree')
            ->assertOk()->json('root_hash');

        $this->actingAs($user)
            ->putJson("/api/folders/{$big->id}", ['sync_excluded' => true])
            ->assertOk()
            ->assertJsonPath('data.sync_excluded', true);

        $r = $this->actingAs($user)->getJson('/api/sync/tree')->assertOk();

        // Папки в дереве остаются — десктопу нужен флаг sync_excluded,
        // а вот файлы исключённой ветки уже не отдаём.
        $folders = collect($r->json('folders'));
        $this->assertTrue((bool) $folders->firstWhere('name', 'Архив')['sync_excluded']);
        $this->assertFalse((bool) $folders->firstWhere('name', 'Вложенная')['sync_excluded']);
        $names = collect($r->json('entries'))->pluck('name')->sort()->values();
        $this->assertSame(['a.txt'], $names->all());

        $hashExcluded = $r->json('root_hash');
        $this->assertNotSame($hashAll, $hashExcluded);

        // Изменения внутри исключённой ветки root_hash не двигают —
        // иначе сравнение хэшей на десктопе разошлось бы навсегда.
        $this->file($user, $nested, 'more.bin', 7, 400);
        $this->assertSame(
            $hashExcluded,
            $this->actingAs($user)->getJson('/api/sync/tree')->json('root_hash'),
        );

        // А в обычной папке — двигают.
        $this->file($user, $docs, 'b.txt', 4, 500);
        $this->assertNotSame(
            $hashExcluded,
            $this->actingAs($user)->getJson('/api/sync/tree')->json('root_hash'),
        );
    }

    public function test_sync_branch_action_dispatches_event(): void
    {
        Event::fake([SyncRequested::class]);
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'd']);

        $this->actingAs($user)->postJson('/api/action', [
            'action' => 'sync.branch',
            'folder_id' => $folder->id,
        ])->assertOk()->assertJsonPath('result.folder_id', $folder->id);

        Event::assertDispatched(
            SyncRequested::class,
            fn ($e) => $e->userId === $user->id && $e->folderId === $folder->id,
        );
    }

    public function test_hash_endpoint_reports_divergence(): void
    {
        $user = User::factory()->create();

        $res = $this->actingAs($user)
            ->postJson('/api/sync/hash', ['root_hash' => str_repeat('0', 64)])
            ->assertOk()
            ->assertJsonPath('diverged', true);

        $real = $res->json('root_hash');
        $this->assertSame(64, strlen($real));

        $this->actingAs($user)
            ->postJson('/api/sync/hash', ['root_hash' => $real])
            ->assertOk()
            ->assertJsonPath('diverged', false);

        // Хэш меняется при изменении дерева
        $this->file($user, null, 'new.txt', 10, 100);
        $this->actingAs($user)
            ->postJson('/api/sync/hash', ['root_hash' => $real])
            ->assertOk()
            ->assertJsonPath('diverged', true);
    }
}
