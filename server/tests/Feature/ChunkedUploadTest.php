<?php

namespace Tests\Feature;

use App\Models\StoredFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ChunkedUploadTest extends TestCase
{
    use RefreshDatabase;

    public function test_chunks_assemble_into_file(): void
    {
        Storage::fake('local');
        Storage::fake('public');
        $user = User::factory()->create();
        $uploadId = 'test-upload-1234';
        $content = str_repeat('chunk-data-', 1000); // ~11 KB в 3 частях
        $parts = str_split($content, 4096);
        $total = count($parts);

        $last = null;
        foreach ($parts as $i => $part) {
            $last = $this->actingAs($user)->post('/api/action', [
                'action' => 'files.uploadChunk',
                'upload_id' => $uploadId,
                'index' => $i,
                'total' => $total,
                'name' => 'big.bin',
                'file' => UploadedFile::fake()->createWithContent('part', $part),
            ]);
        }

        $last->assertOk()->assertJsonPath('ok', true);
        $file = StoredFile::where('user_id', $user->id)->latest()->firstOrFail();
        $this->assertSame('big.bin', $file->name);
        $this->assertSame(strlen($content), $file->size);
        Storage::disk('public')->assertExists($file->path);
        $this->assertSame($content, Storage::disk('public')->get($file->path));
    }

    public function test_partial_upload_returns_received_count(): void
    {
        Storage::fake('local');
        Storage::fake('public');
        $user = User::factory()->create();

        $res = $this->actingAs($user)->post('/api/action', [
            'action' => 'files.uploadChunk',
            'upload_id' => 'partial-9999',
            'index' => 0,
            'total' => 3,
            'name' => 'x.bin',
            'file' => UploadedFile::fake()->createWithContent('part', 'abc'),
        ]);

        $res->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('result.original.received', 1);
    }
}
