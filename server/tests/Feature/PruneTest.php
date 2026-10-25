<?php

namespace Tests\Feature;

use App\Models\DeletedFile;
use App\Models\Screenshot;
use App\Models\StoredFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class PruneTest extends TestCase
{
    use RefreshDatabase;

    private function file(User $user, array $attrs = []): StoredFile
    {
        return StoredFile::create(array_merge([
            'user_id' => $user->id,
            'uuid' => (string) Str::uuid(),
            'name' => 'f.txt',
            'filename' => 'f.txt',
            'size' => 1,
            'path' => 'files/ab/cd/'.Str::uuid().'.txt',
            'mtime' => 1,
        ], $attrs));
    }

    public function test_expired_uploads_go_to_trash_not_hard_delete(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->file($user, ['expires_at' => now()->subDay()]);
        Storage::disk('public')->put($file->path, 'x');
        $shot = Screenshot::create([
            'user_id' => $user->id,
            'uuid' => (string) Str::uuid(),
            'filename' => 's.png',
            'mime_type' => 'image/png',
            'size' => 1,
            'path' => 'files/aa/bb/s.png',
            'expires_at' => now()->subDay(),
        ]);

        $this->artisan('uploads:prune')->assertSuccessful();

        $this->assertSoftDeleted('files', ['id' => $file->id]);
        $this->assertSoftDeleted('screenshots', ['id' => $shot->id]);
        Storage::disk('public')->assertExists($file->path);
        $this->assertDatabaseHas('deleted_files', ['kind' => 'file', 'name' => 'f.txt']);
        $this->assertDatabaseHas('deleted_files', ['kind' => 'screenshot', 'name' => 's.png']);
    }

    public function test_trash_older_than_retention_is_purged(): void
    {
        Storage::fake('public');
        $user = User::factory()->create(['trash_retention_days' => 14]);
        $fresh = $this->file($user);
        $stale = $this->file($user);
        Storage::disk('public')->put($fresh->path, 'x');
        Storage::disk('public')->put($stale->path, 'y');

        $this->actingAs($user)->deleteJson("/api/files/{$fresh->id}")->assertOk();
        $this->actingAs($user)->deleteJson("/api/files/{$stale->id}")->assertOk();
        $stale->forceFill(['deleted_at' => now()->subDays(20)])->save();

        $this->artisan('uploads:prune')->assertSuccessful();

        $this->assertSoftDeleted('files', ['id' => $fresh->id]);
        $this->assertDatabaseMissing('files', ['id' => $stale->id]);
        Storage::disk('public')->assertMissing($stale->path);
        Storage::disk('public')->assertExists($fresh->path);
    }

    public function test_tombstones_older_than_six_months_are_pruned(): void
    {
        $user = User::factory()->create();
        DeletedFile::create([
            'user_id' => $user->id, 'kind' => 'file', 'name' => 'old', 'size' => 1,
            'entry_hash' => str_repeat('a', 64), 'dir_path' => '',
            'deleted_at' => now()->subMonths(7),
        ]);
        DeletedFile::create([
            'user_id' => $user->id, 'kind' => 'file', 'name' => 'new', 'size' => 1,
            'entry_hash' => str_repeat('b', 64), 'dir_path' => '',
            'deleted_at' => now(),
        ]);

        $this->artisan('uploads:prune')->assertSuccessful();

        $this->assertDatabaseMissing('deleted_files', ['name' => 'old']);
        $this->assertDatabaseHas('deleted_files', ['name' => 'new']);
    }
}
