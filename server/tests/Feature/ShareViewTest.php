<?php

namespace Tests\Feature;

use App\Jobs\ProcessUploadedFile;
use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\ShareLink;
use App\Models\StoredFile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class ShareViewTest extends TestCase
{
    use RefreshDatabase;

    private function makeFile(User $user, ?Folder $folder = null, array $attrs = []): StoredFile
    {
        $file = StoredFile::create(array_merge([
            'user_id' => $user->id,
            'folder_id' => $folder?->id,
            'uuid' => (string) Str::uuid(),
            'name' => 'doc.pdf',
            'filename' => 'doc.pdf',
            'mime_type' => 'application/pdf',
            'size' => 100,
            'path' => 'files/ab/cd/'.(string) Str::uuid().'.pdf',
            'mtime' => 1700000000,
        ], $attrs));
        Storage::disk('public')->put($file->path, 'pdf-data');

        return $file;
    }

    private function makeLink(User $user, StoredFile|Folder $target, array $attrs = []): ShareLink
    {
        return ShareLink::create(array_merge([
            'user_id' => $user->id,
            'token' => ShareLink::newToken(),
            'linkable_type' => $target::class,
            'linkable_id' => $target->id,
        ], $attrs));
    }

    public function test_file_link_redirects_to_spa_viewer(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $link = $this->makeLink($user, $this->makeFile($user));

        $this->get("/f/{$link->token}")->assertRedirect("/share/f/{$link->token}");
    }

    public function test_share_info_and_raw_for_file_link(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user);
        $link = $this->makeLink($user, $file);

        $this->getJson("/api/share/{$link->token}")
            ->assertOk()
            ->assertJsonPath('type', 'file')
            ->assertJsonPath('file.name', 'doc.pdf')
            ->assertJsonPath('file.uuid', $file->uuid);

        $this->get("/api/share/{$link->token}/file/{$file->uuid}/raw")
            ->assertOk()
            ->assertHeader('Content-Type', 'application/pdf');

        $this->get("/api/share/{$link->token}/file/{$file->uuid}/download")
            ->assertOk()
            ->assertHeader('Content-Disposition', 'attachment; filename=doc.pdf');
    }

    public function test_share_link_does_not_leak_other_files(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $link = $this->makeLink($user, $this->makeFile($user));
        $other = $this->makeFile($user);

        $this->get("/api/share/{$link->token}/file/{$other->uuid}/raw")->assertNotFound();
    }

    public function test_folder_link_lists_files(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Документы']);
        $this->makeFile($user, $folder, ['name' => 'a.pdf']);
        $this->makeFile($user, $folder, ['name' => 'b.pdf']);
        $link = $this->makeLink($user, $folder);

        $this->get("/d/{$link->token}")->assertRedirect("/share/d/{$link->token}");

        $res = $this->getJson("/api/share/{$link->token}")->assertOk()
            ->assertJsonPath('type', 'folder')
            ->assertJsonPath('name', 'Документы')
            ->assertJsonPath('can_write', false);

        $this->assertCount(2, $res->json('files'));
    }

    public function test_upload_into_shared_folder_requires_can_write(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Входящие']);
        $link = $this->makeLink($user, $folder);

        $this->post("/api/share/{$link->token}/upload", [
            'file' => UploadedFile::fake()->create('guest.txt', 4),
        ])->assertForbidden();

        $rw = $this->makeLink($user, $folder, ['can_write' => true]);
        $this->post("/api/share/{$rw->token}/upload", [
            'file' => UploadedFile::fake()->create('guest.txt', 4, 'text/plain'),
        ])->assertCreated();

        $this->assertDatabaseHas('files', [
            'user_id' => $user->id,
            'folder_id' => $folder->id,
            'name' => 'guest.txt',
        ]);
    }

    public function test_expired_link_returns_410(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $link = $this->makeLink($user, $this->makeFile($user), [
            'expires_at' => now()->subDay(),
        ]);

        $this->getJson("/api/share/{$link->token}")->assertStatus(410);
    }

    public function test_file_move_via_action(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Цель']);
        $file = $this->makeFile($user);

        $this->actingAs($user)->postJson('/api/action', [
            'action' => 'files.move',
            'id' => $file->id,
            'folder_id' => $folder->id,
        ])->assertOk();

        $this->assertSame($folder->id, $file->fresh()->folder_id);
    }

    public function test_folder_with_disabled_conversion_skips_job(): void
    {
        Storage::fake('public');
        Queue::fake();
        $user = User::factory()->create();
        $folder = Folder::create([
            'user_id' => $user->id,
            'name' => 'Без конвертации',
            'conversion_enabled' => false,
        ]);

        $this->actingAs($user)->post('/api/files', [
            'file' => UploadedFile::fake()->image('pic.png', 320, 200),
            'folder_id' => $folder->id,
        ])->assertCreated();

        $this->assertSame('none', StoredFile::firstOrFail()->conversion_status);
        Queue::assertNotPushed(ProcessUploadedFile::class);
    }

    public function test_bare_screenshot_url_redirects_to_viewer(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $shot = Screenshot::create([
            'user_id' => $user->id,
            'uuid' => (string) Str::uuid(),
            'filename' => 's.png',
            'mime_type' => 'image/png',
            'size' => 4,
            'path' => 'files/aa/bb/s.png',
        ]);
        Storage::disk('public')->put($shot->path, 'img');

        // Голый uuid — просмотрщик в интерфейсе.
        $this->get("/i/{$shot->uuid}")->assertRedirect("/share/i/{$shot->uuid}");
        // С расширением — сырая картинка (встраивание в мессенджерах).
        $this->get("/i/{$shot->uuid}.png")->assertOk()
            ->assertHeader('Content-Type', 'image/png');
    }
}
