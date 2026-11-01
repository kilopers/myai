<?php

namespace Tests\Feature;

use App\Models\StoredFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class FilePositionTest extends TestCase
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

    public function test_position_requires_auth_and_ownership(): void
    {
        $file = $this->makeFile(User::factory()->create());
        $other = User::factory()->create();

        $this->getJson("/api/files/{$file->id}/position")->assertUnauthorized();
        $this->putJson("/api/files/{$file->id}/position", ['position' => ['seconds' => 5]])
            ->assertUnauthorized();
        $this->actingAs($other)->getJson("/api/files/{$file->id}/position")->assertForbidden();
        $this->actingAs($other)->putJson("/api/files/{$file->id}/position", ['position' => ['page' => 3]])
            ->assertForbidden();
    }

    public function test_position_roundtrip_seconds_and_page(): void
    {
        $user = User::factory()->create();
        $file = $this->makeFile($user);

        // По умолчанию — null
        $this->actingAs($user)->getJson("/api/files/{$file->id}/position")
            ->assertOk()->assertExactJson(['position' => null]);

        // Видео: секунды сохраняются и отдаются обратно
        $this->actingAs($user)->putJson("/api/files/{$file->id}/position", [
            'position' => ['seconds' => 137],
        ])->assertOk()->assertExactJson(['position' => ['seconds' => 137]]);

        $this->actingAs($user)->getJson("/api/files/{$file->id}/position")
            ->assertOk()->assertExactJson(['position' => ['seconds' => 137]]);

        // view_state виден и в ресурсе файла (список)
        $this->actingAs($user)->getJson('/api/files')
            ->assertOk()->assertJsonPath('data.0.view_state.seconds', 137);

        // Постраничный режим
        $this->actingAs($user)->putJson("/api/files/{$file->id}/position", [
            'position' => ['page' => 7],
        ])->assertOk();
        $this->assertSame(['page' => 7], $file->fresh()->view_state);
    }

    public function test_position_validation(): void
    {
        $user = User::factory()->create();
        $file = $this->makeFile($user);

        // Нет position — 422
        $this->actingAs($user)->putJson("/api/files/{$file->id}/position", [])->assertUnprocessable();

        // Пустой объект — 422 (нет ни page, ни seconds)
        $this->actingAs($user)->putJson("/api/files/{$file->id}/position", ['position' => []])
            ->assertUnprocessable();

        // Мусорные значения — 422
        $this->actingAs($user)->putJson("/api/files/{$file->id}/position", ['position' => ['page' => 0]])
            ->assertUnprocessable();
        $this->actingAs($user)->putJson("/api/files/{$file->id}/position", ['position' => ['seconds' => -3]])
            ->assertUnprocessable();

        // Лишние ключи отбрасываются
        $this->actingAs($user)->putJson("/api/files/{$file->id}/position", [
            'position' => ['seconds' => 10, 'hack' => 'x'],
        ])->assertOk()->assertExactJson(['position' => ['seconds' => 10]]);
    }
}
