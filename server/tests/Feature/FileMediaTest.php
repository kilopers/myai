<?php

namespace Tests\Feature;

use App\Models\FileDerivative;
use App\Models\StoredFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FileMediaTest extends TestCase
{
    use RefreshDatabase;

    private function makeFile(User $user, array $attrs = []): StoredFile
    {
        return StoredFile::create(array_merge([
            'user_id' => $user->id,
            'uuid' => (string) Str::uuid(),
            'name' => 'movie.mkv',
            'filename' => 'movie.mkv',
            'mime_type' => 'video/x-matroska',
            'size' => 100,
            'path' => 'files/ab/cd/'.(string) Str::uuid().'.mkv',
            'mtime' => 1700000000,
        ], $attrs));
    }

    private function mediaUrls(User $user, StoredFile $file): array
    {
        return $this->actingAs($user)
            ->getJson("/api/files/{$file->id}/media-url")
            ->assertOk()
            ->json();
    }

    public function test_media_url_requires_auth(): void
    {
        $file = $this->makeFile(User::factory()->create());

        $this->getJson("/api/files/{$file->id}/media-url")->assertUnauthorized();
    }

    public function test_media_url_forbidden_for_foreign_file(): void
    {
        $file = $this->makeFile(User::factory()->create());
        $other = User::factory()->create();

        $this->actingAs($other)->getJson("/api/files/{$file->id}/media-url")->assertForbidden();
    }

    public function test_signed_stream_serves_video_derivative_with_range(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user);

        $path = "derivatives/ab/cd/{$file->uuid}/video.mp4";
        Storage::disk('public')->put($path, '0123456789abcdef');
        $file->derivatives()->create([
            'kind' => FileDerivative::KIND_VIDEO,
            'path' => $path,
            'mime_type' => 'video/mp4',
            'size' => 16,
        ]);

        ['stream' => $url] = $this->mediaUrls($user, $file);
        $this->assertStringContainsString("/api/files/{$file->id}/media", $url);

        // Полный GET — без Bearer, доступ по подписи.
        $this->get($url)->assertOk()
            ->assertHeader('Content-Type', 'video/mp4')
            ->assertHeader('Accept-Ranges', 'bytes');

        // Range-запрос — браузер так мотает видео, не качая файл целиком.
        $res = $this->get($url, ['Range' => 'bytes=4-7'])
            ->assertStatus(206)
            ->assertHeader('Content-Range', 'bytes 4-7/16');
        $this->assertSame('4567', $res->streamedContent());
    }

    public function test_signed_stream_falls_back_to_original(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user, ['mime_type' => 'video/mp4']);
        Storage::disk('public')->put($file->path, 'raw-bytes');

        ['stream' => $url] = $this->mediaUrls($user, $file);
        $this->assertSame('raw-bytes', $this->get($url)->assertOk()->streamedContent());
    }

    public function test_signed_download_serves_original_as_attachment(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user, ['name' => 'My Movie 2026.mkv']);
        Storage::disk('public')->put($file->path, 'big-file-bytes');

        ['download' => $url] = $this->mediaUrls($user, $file);
        $res = $this->get($url)->assertOk();
        $this->assertSame('big-file-bytes', $res->streamedContent());
        $this->assertStringContainsString('attachment', (string) $res->headers->get('Content-Disposition'));
    }

    public function test_media_rejects_bad_or_expired_signature(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user);
        Storage::disk('public')->put($file->path, 'x');

        ['stream' => $url] = $this->mediaUrls($user, $file);

        // Подпись для другого mode/файла не подходит.
        $this->get(str_replace('mode=stream', 'mode=original', $url))->assertForbidden();
        $this->get($url.'0')->assertForbidden();

        // Просроченная подпись (exp в прошлом).
        $exp = time() - 60;
        $sig = hash_hmac('sha256', "{$file->id}|stream|{$exp}", (string) config('app.key'));
        $this->get("/api/files/{$file->id}/media?mode=stream&exp={$exp}&sig={$sig}")
            ->assertForbidden();

        // Невалидный mode — 404.
        $sig = hash_hmac('sha256', "{$file->id}|bogus|{$exp}", (string) config('app.key'));
        $this->get("/api/files/{$file->id}/media?mode=bogus&exp={$exp}&sig={$sig}")
            ->assertNotFound();
    }
}
