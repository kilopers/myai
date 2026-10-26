<?php

namespace Tests\Feature;

use App\Events\DirsChanged;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DirsChangedTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Правила канала и имени события живого обновления.
     */
    private function assertDirsChangedOnUserChannel(User $user): void
    {
        Event::assertDispatched(
            DirsChanged::class,
            fn (DirsChanged $e) => $e->broadcastOn()->name === 'sync.user.'.$user->id
                && $e->broadcastAs() === 'dirs.changed',
        );
    }

    public function test_upload_to_folder_broadcasts_root_and_folder_hashes(): void
    {
        Storage::fake('public');
        Event::fake([DirsChanged::class]);
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Документы']);

        $this->actingAs($user)->post('/api/action', [
            'action' => 'files.upload',
            'folder_id' => $folder->id,
            'file' => UploadedFile::fake()->create('a.txt', 10),
        ])->assertOk()->assertJsonPath('ok', true);

        Event::assertDispatchedTimes(DirsChanged::class, 1);
        $this->assertDirsChangedOnUserChannel($user);
        Event::assertDispatched(DirsChanged::class, function (DirsChanged $e) use ($folder) {
            $root = collect($e->dirs)->firstWhere('folder_id', null);
            $own = collect($e->dirs)->firstWhere('folder_id', $folder->id);

            return $root !== null
                && $own !== null
                && $own['dir_hash'] === $folder->fresh()->dirHash();
        });
    }

    public function test_upload_to_root_broadcasts_only_root_entry(): void
    {
        Storage::fake('public');
        Event::fake([DirsChanged::class]);
        $user = User::factory()->create();

        $this->actingAs($user)->post('/api/action', [
            'action' => 'files.upload',
            'file' => UploadedFile::fake()->create('b.txt', 5),
        ])->assertOk();

        Event::assertDispatched(DirsChanged::class, function (DirsChanged $e) {
            return count($e->dirs) === 1 && $e->dirs[0]['folder_id'] === null;
        });
    }

    public function test_deleted_folder_is_sent_with_null_hash(): void
    {
        Storage::fake('public');
        Event::fake([DirsChanged::class]);
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Времянка']);

        $this->actingAs($user)->post('/api/action', [
            'action' => 'folders.delete',
            'id' => $folder->id,
        ])->assertOk();

        Event::assertDispatched(DirsChanged::class, function (DirsChanged $e) use ($folder) {
            $gone = collect($e->dirs)->firstWhere('folder_id', $folder->id);
            $root = collect($e->dirs)->firstWhere('folder_id', null);

            return $gone !== null && $gone['dir_hash'] === null && $root !== null;
        });
    }

    public function test_screenshot_upload_broadcasts_screenshots_hash(): void
    {
        Storage::fake('public');
        Event::fake([DirsChanged::class]);
        $user = User::factory()->create();

        $this->actingAs($user)->post('/api/screenshots', [
            'image' => UploadedFile::fake()->image('shot.png'),
        ])->assertCreated();

        Event::assertDispatched(
            DirsChanged::class,
            fn (DirsChanged $e) => $e->screenshotsHash !== null && $e->dirs === [],
        );
    }

    public function test_state_requests_do_not_broadcast(): void
    {
        Storage::fake('public');
        Event::fake([DirsChanged::class]);
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/action', ['action' => 'files.state'])->assertOk();
        $this->actingAs($user)->postJson('/api/action', ['action' => 'screenshots.state'])->assertOk();
        $this->actingAs($user)->postJson('/api/action', ['action' => 'dir.watch'])->assertOk();

        Event::assertNotDispatched(DirsChanged::class);
    }

    public function test_files_state_returns_dir_hash(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Папка']);

        $root = $this->actingAs($user)->postJson('/api/action', ['action' => 'files.state']);
        $root->assertOk();
        $hash = $root->json('state.dir_hash');
        $this->assertIsString($hash);
        $this->assertSame(64, strlen($hash));

        $inner = $this->actingAs($user)->postJson('/api/action', [
            'action' => 'files.state',
            'folder_id' => $folder->id,
        ]);
        $inner->assertOk()->assertJsonPath('state.dir_hash', $folder->dirHash());
    }

    public function test_dir_watch_reports_divergence(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $state = $this->actingAs($user)->postJson('/api/action', ['action' => 'files.state']);
        $hash = $state->json('state.dir_hash');

        // Свежий хэш — расхождений нет.
        $this->actingAs($user)->postJson('/api/action', [
            'action' => 'dir.watch',
            'folder_id' => null,
            'dir_hash' => $hash,
        ])->assertOk()->assertJsonPath('result.diverged', false);

        // Мутация в корне → старый хэш устарел.
        $this->actingAs($user)->post('/api/action', [
            'action' => 'files.upload',
            'file' => UploadedFile::fake()->create('c.txt', 3),
        ])->assertOk();

        $res = $this->actingAs($user)->postJson('/api/action', [
            'action' => 'dir.watch',
            'folder_id' => null,
            'dir_hash' => $hash,
        ])->assertOk();
        $res->assertJsonPath('result.diverged', true);
        $this->assertNotSame($hash, $res->json('result.dir_hash'));
    }

    public function test_dir_watch_gone_folder(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'Пропажа']);
        $folder->delete(); // в корзину — для watcher'а её больше нет

        $this->actingAs($user)->postJson('/api/action', [
            'action' => 'dir.watch',
            'folder_id' => $folder->id,
            'dir_hash' => 'whatever',
        ])->assertOk()
            ->assertJsonPath('result.diverged', true)
            ->assertJsonPath('result.gone', true);
    }

    public function test_dir_watch_screenshots_scope(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $state = $this->actingAs($user)->postJson('/api/action', ['action' => 'screenshots.state']);
        $hash = $state->json('state.dir_hash');
        $this->assertIsString($hash);

        $this->actingAs($user)->postJson('/api/action', [
            'action' => 'dir.watch',
            'scope' => 'screenshots',
            'dir_hash' => $hash,
        ])->assertOk()->assertJsonPath('result.diverged', false);

        $this->actingAs($user)->post('/api/screenshots', [
            'image' => UploadedFile::fake()->image('s.png'),
        ])->assertCreated();

        $this->actingAs($user)->postJson('/api/action', [
            'action' => 'dir.watch',
            'scope' => 'screenshots',
            'dir_hash' => $hash,
        ])->assertOk()->assertJsonPath('result.diverged', true);
    }
}
