<?php

namespace Tests\Feature;

use App\Models\Folder;
use App\Models\User;
use App\Services\StoredFileWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class StorageSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_summary_aggregates_db_sizes_and_folder_cache(): void
    {
        Storage::fake('public');
        $this->getJson('/api/storage/summary')->assertUnauthorized();
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Docs']);

        $writer = app(StoredFileWriter::class);
        $writer->register($user, $folder, [
            'uuid' => (string) Str::uuid(),
            'name' => 'a.bin',
            'filename' => 'a.bin',
            'mime_type' => 'application/octet-stream',
            'size' => 1000,
            'path' => 'files/a',
            'mtime' => 1,
        ]);
        $writer->register($user, null, [
            'uuid' => (string) Str::uuid(),
            'name' => 'b.bin',
            'filename' => 'b.bin',
            'mime_type' => 'application/octet-stream',
            'size' => 2000,
            'path' => 'files/b',
            'mtime' => 1,
        ]);

        // Кэш размера папки поддерживается пересчётом хэша.
        $this->assertSame(1000, (int) $folder->fresh()->size);

        $res = $this->actingAs($user)->getJson('/api/storage/summary')->assertOk();
        $res->assertJsonPath('files.count', 2)
            ->assertJsonPath('files.size', 3000)
            ->assertJsonPath('folders_size', 1000);
        $this->assertArrayHasKey('disk', $res->json());
        $this->assertGreaterThan(0, $res->json('disk.total'));

        $this->actingAs($user)->getJson('/api/storage/real-size')
            ->assertOk()->assertJsonStructure(['paths' => ['files', 'torrents'], 'total']);
    }
}
