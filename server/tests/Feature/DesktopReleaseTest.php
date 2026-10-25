<?php

namespace Tests\Feature;

use App\Events\UpdateAvailable;
use App\Jobs\DesktopReleaseSyncJob;
use App\Services\DesktopReleaseSync;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

class DesktopReleaseTest extends TestCase
{
    use RefreshDatabase;

    private function fakeGitHubRelease(string $version = '1.0.0'): void
    {
        Http::fake([
            'api.github.com/*' => Http::response([
                'tag_name' => "v{$version}",
                'html_url' => "https://github.com/kilopers/screenshoter/releases/tag/v{$version}",
                'assets' => [
                    ['name' => "Screenshoter_{$version}_x64-setup.exe", 'browser_download_url' => 'https://example.com/app.exe'],
                    ['name' => "Screenshoter_{$version}_x64_en-US.msi", 'browser_download_url' => 'https://example.com/app.msi'],
                    ['name' => "Screenshoter_{$version}_aarch64.dmg", 'browser_download_url' => 'https://example.com/app.dmg'],
                ],
            ], 200),
            '*' => Http::response('fake-installer-binary', 200),
        ]);
    }

    public function test_desktop_version_falls_back_to_version_file(): void
    {
        Storage::fake('public');

        $r = $this->getJson('/api/desktop-version')->assertOk();

        $this->assertSame(app(DesktopReleaseSync::class)->appVersion(), $r->json('version'));
        $this->assertNull($r->json('downloads'));
        $this->assertSame(
            'https://github.com/kilopers/screenshoter/releases/tag/v'.$r->json('version'),
            $r->json('notes_url'),
        );
    }

    public function test_desktop_version_returns_manifest_downloads(): void
    {
        Storage::fake('public');
        Storage::disk('public')->put('desktop/latest.json', json_encode([
            'version' => '1.0.0',
            'files' => ['windows' => 'app.msi', 'macos' => 'app.dmg'],
            'notes_url' => 'https://github.com/kilopers/screenshoter/releases/tag/v1.0.0',
            'fetched_at' => now()->toIso8601String(),
        ]));

        $r = $this->getJson('/api/desktop-version')->assertOk();

        $this->assertSame('1.0.0', $r->json('version'));
        $this->assertSame('/api/desktop-download/windows', $r->json('downloads.windows'));
        $this->assertSame('/api/desktop-download/macos', $r->json('downloads.macos'));
        $this->assertSame(
            'https://github.com/kilopers/screenshoter/releases/tag/v1.0.0',
            $r->json('notes_url'),
        );
    }

    public function test_desktop_download_streams_installer(): void
    {
        Storage::fake('public');
        Storage::disk('public')->put('desktop/1.0.0/app.msi', 'installer-bytes');
        Storage::disk('public')->put('desktop/latest.json', json_encode([
            'version' => '1.0.0',
            'files' => ['windows' => 'app.msi'],
        ]));

        $r = $this->get('/api/desktop-download/windows')->assertOk();

        $this->assertSame('installer-bytes', $r->streamedContent());
    }

    public function test_desktop_download_404_without_manifest_or_file(): void
    {
        Storage::fake('public');

        $this->get('/api/desktop-download/windows')->assertNotFound();
        $this->get('/api/desktop-download/linux')->assertNotFound();

        Storage::disk('public')->put('desktop/latest.json', json_encode([
            'version' => '1.0.0',
            'files' => ['windows' => 'missing.msi'],
        ]));

        $this->get('/api/desktop-download/windows')->assertNotFound();
        $this->get('/api/desktop-download/macos')->assertNotFound();
    }

    public function test_sync_downloads_assets_writes_manifest_and_cleans_old_versions(): void
    {
        Storage::fake('public');
        Storage::disk('public')->put('desktop/0.9.0/old.msi', 'stale');
        $this->fakeGitHubRelease('1.0.0');

        $manifest = app(DesktopReleaseSync::class)->sync('v1.0.0');

        $this->assertSame('1.0.0', $manifest['version']);
        $this->assertSame('Screenshoter_1.0.0_x64_en-US.msi', $manifest['files']['windows']);
        $this->assertSame('Screenshoter_1.0.0_aarch64.dmg', $manifest['files']['macos']);

        $disk = Storage::disk('public');
        $this->assertSame(
            'fake-installer-binary',
            $disk->get('desktop/1.0.0/Screenshoter_1.0.0_x64_en-US.msi')
        );
        $this->assertTrue($disk->exists('desktop/1.0.0/Screenshoter_1.0.0_aarch64.dmg'));
        // .exe игнорируется — предпочтён .msi
        $this->assertFalse($disk->exists('desktop/1.0.0/Screenshoter_1.0.0_x64-setup.exe'));
        // старая версия удалена
        $this->assertFalse($disk->exists('desktop/0.9.0/old.msi'));

        $saved = json_decode($disk->get('desktop/latest.json'), true);
        $this->assertSame('1.0.0', $saved['version']);
        $this->assertSame('https://github.com/kilopers/screenshoter/releases/tag/v1.0.0', $saved['notes_url']);
    }

    public function test_sync_is_idempotent_and_skips_existing_files(): void
    {
        Storage::fake('public');
        Storage::disk('public')->put('desktop/1.0.0/Screenshoter_1.0.0_x64_en-US.msi', 'already-here');
        $this->fakeGitHubRelease('1.0.0');

        app(DesktopReleaseSync::class)->sync('1.0.0');

        $disk = Storage::disk('public');
        $this->assertSame('already-here', $disk->get('desktop/1.0.0/Screenshoter_1.0.0_x64_en-US.msi'));
        $this->assertSame('fake-installer-binary', $disk->get('desktop/1.0.0/Screenshoter_1.0.0_aarch64.dmg'));
    }

    public function test_sync_github_error_keeps_existing_manifest(): void
    {
        Storage::fake('public');
        Storage::disk('public')->put('desktop/latest.json', json_encode(['version' => '0.9.0']));
        Http::fake(['*' => Http::response('not found', 404)]);

        try {
            app(DesktopReleaseSync::class)->sync('9.9.9');
            $this->fail('Ожидался RuntimeException');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('404', $e->getMessage());
        }

        $this->assertSame(
            '0.9.0',
            json_decode(Storage::disk('public')->get('desktop/latest.json'), true)['version']
        );
    }

    public function test_webhook_rejects_invalid_or_missing_token(): void
    {
        Queue::fake();
        config(['services.release_sync.token' => 'secret-token']);

        $this->postJson('/api/desktop-release/sync', ['version' => 'v1.0.0'])
            ->assertUnauthorized();
        $this->withHeaders(['Authorization' => 'Bearer wrong'])
            ->postJson('/api/desktop-release/sync', ['version' => 'v1.0.0'])
            ->assertUnauthorized();

        Queue::assertNothingPushed();
    }

    public function test_webhook_accepts_valid_token_and_dispatches_job(): void
    {
        Queue::fake();
        config(['services.release_sync.token' => 'secret-token']);

        $this->withHeaders(['Authorization' => 'Bearer secret-token'])
            ->postJson('/api/desktop-release/sync', ['version' => 'v1.0.0'])
            ->assertAccepted();

        Queue::assertPushed(DesktopReleaseSyncJob::class, fn (DesktopReleaseSyncJob $job) => $job->version === '1.0.0');
    }

    public function test_webhook_rejects_when_token_not_configured(): void
    {
        Queue::fake();
        config(['services.release_sync.token' => null]);

        $this->withHeaders(['Authorization' => 'Bearer whatever'])
            ->postJson('/api/desktop-release/sync', ['version' => 'v1.0.0'])
            ->assertUnauthorized();
    }

    public function test_update_available_broadcasts_once_per_version(): void
    {
        Storage::fake('public');
        Event::fake([UpdateAvailable::class]);
        $sync = app(DesktopReleaseSync::class);

        $manifest = [
            'version' => '1.0.0',
            'files' => ['windows' => 'app.msi'],
            'notes_url' => 'https://github.com/kilopers/screenshoter/releases/tag/v1.0.0',
        ];

        $this->assertTrue($sync->broadcastIfNew($manifest));
        $this->assertFalse($sync->broadcastIfNew($manifest));

        Event::assertDispatchedTimes(UpdateAvailable::class, 1);
        Event::assertDispatched(UpdateAvailable::class, function (UpdateAvailable $e) {
            return $e->broadcastAs() === 'app.update-available'
                && $e->broadcastOn()->name === 'app.updates'
                && $e->broadcastWith() === [
                    'version' => '1.0.0',
                    'downloads' => ['windows' => '/api/desktop-download/windows'],
                    'notes_url' => 'https://github.com/kilopers/screenshoter/releases/tag/v1.0.0',
                ];
        });

        Cache::forget(DesktopReleaseSync::ANNOUNCED_CACHE_KEY);
        $this->assertTrue($sync->broadcastIfNew($manifest));
    }

    public function test_job_syncs_release_and_broadcasts(): void
    {
        Storage::fake('public');
        Event::fake([UpdateAvailable::class]);
        $this->fakeGitHubRelease('1.0.0');

        (new DesktopReleaseSyncJob('v1.0.0'))->handle(app(DesktopReleaseSync::class));

        $this->assertTrue(Storage::disk('public')->exists('desktop/latest.json'));
        Event::assertDispatched(UpdateAvailable::class, fn (UpdateAvailable $e) => $e->version === '1.0.0');
    }

    public function test_command_syncs_and_announces(): void
    {
        Storage::fake('public');
        Event::fake([UpdateAvailable::class]);
        $this->fakeGitHubRelease('1.0.0');

        $this->artisan('app:desktop-release-sync', ['version' => 'v1.0.0'])
            ->assertSuccessful();

        $this->assertTrue(Storage::disk('public')->exists('desktop/1.0.0/Screenshoter_1.0.0_x64_en-US.msi'));
        Event::assertDispatched(UpdateAvailable::class);
    }

    public function test_command_fails_cleanly_on_github_error(): void
    {
        Storage::fake('public');
        Http::fake(['*' => Http::response('oops', 500)]);

        $this->artisan('app:desktop-release-sync', ['version' => '9.9.9'])
            ->assertFailed();
    }
}
