<?php

namespace Tests\Feature;

use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\StoredFile;
use App\Models\User;
use App\Support\StoragePath;
use App\Support\SyncHash;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class RelayoutStorageTest extends TestCase
{
    use RefreshDatabase;

    public function test_relayout_moves_files_and_fills_hashes(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $uuid = (string) Str::uuid();
        $legacy = "files/{$uuid}.txt";
        Storage::disk('public')->put($legacy, 'data');
        $file = StoredFile::create([
            'user_id' => $user->id,
            'uuid' => $uuid,
            'name' => 'a.txt',
            'filename' => "{$uuid}.txt",
            'mime_type' => 'text/plain',
            'size' => 4,
            'path' => $legacy,
        ]);

        $sUuid = (string) Str::uuid();
        $legacyShot = "screenshots/{$sUuid}.png";
        Storage::disk('public')->put($legacyShot, 'img');
        $shot = Screenshot::create([
            'user_id' => $user->id,
            'uuid' => $sUuid,
            'filename' => "{$sUuid}.png",
            'mime_type' => 'image/png',
            'size' => 3,
            'path' => $legacyShot,
        ]);

        $this->artisan('storage:relayout')->assertSuccessful();

        // Файлы переложены в files/{ab}/{cd}/
        $file->refresh();
        $this->assertSame(StoragePath::file($uuid, 'txt'), $file->path);
        $this->assertMatchesRegularExpression('#^files/[0-9a-f]{2}/[0-9a-f]{2}/#', $file->path);
        Storage::disk('public')->assertExists($file->path);
        Storage::disk('public')->assertMissing($legacy);
        $this->assertNotNull($file->mtime);
        $this->assertSame(
            SyncHash::file('a.txt', 4, $file->mtime),
            $file->entry_hash,
        );

        $shot->refresh();
        $this->assertMatchesRegularExpression('#^files/[0-9a-f]{2}/[0-9a-f]{2}/#', $shot->path);
        Storage::disk('public')->assertExists($shot->path);
        Storage::disk('public')->assertMissing($legacyShot);

        // Системная папка «Скриншоты» создана
        $this->assertDatabaseHas('folders', [
            'user_id' => $user->id,
            'name' => Folder::SCREENSHOTS_DIR,
            'is_system' => true,
        ]);

        // Идемпотентность: повторный запуск ничего не ломает
        $this->artisan('storage:relayout')->assertSuccessful();
        $this->assertSame($shot->path, $shot->fresh()->path);
        $this->assertSame(1, Folder::where('user_id', $user->id)
            ->where('name', Folder::SCREENSHOTS_DIR)->count());
    }

    public function test_relayout_computes_dir_hashes(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'docs']);
        $child = Folder::create(['user_id' => $user->id, 'name' => 'sub', 'parent_id' => $folder->id]);
        StoredFile::create([
            'user_id' => $user->id,
            'folder_id' => $child->id,
            'uuid' => (string) Str::uuid(),
            'name' => 'f.txt',
            'filename' => 'f.txt',
            'size' => 1,
            'path' => 'files/x.txt',
            'mtime' => 10,
        ]);

        $this->artisan('storage:relayout')->assertSuccessful();

        $child->refresh();
        $folder->refresh();
        $this->assertSame(
            SyncHash::dir([['name' => 'f.txt', 'hash' => SyncHash::file('f.txt', 1, 10)]]),
            $child->dir_hash,
        );
        $this->assertSame(
            SyncHash::dir([[
                'name' => 'sub',
                'hash' => SyncHash::folderEntry('sub', $child->dir_hash),
            ]]),
            $folder->dir_hash,
        );
        // Корневой хэш: docs + системная «Скриншоты» (создана командой)
        $sys = Folder::where('user_id', $user->id)->where('name', Folder::SCREENSHOTS_DIR)->first();
        $this->assertSame(
            SyncHash::dir([
                ['name' => 'docs', 'hash' => SyncHash::folderEntry('docs', $folder->dir_hash)],
                ['name' => Folder::SCREENSHOTS_DIR, 'hash' => SyncHash::folderEntry(Folder::SCREENSHOTS_DIR, $sys->dirHash())],
            ]),
            SyncHash::rootHash($user),
        );
    }
}
