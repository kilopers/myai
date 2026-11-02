<?php

namespace Tests\Feature;

use App\Models\Folder;
use App\Models\StoredFile;
use App\Models\Torrent;
use App\Models\TorrentSetting;
use App\Models\User;
use App\Services\Torrent\TorrentEngine;
use App\Services\Torrent\TorrentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Фейк движка: сеть и aria2-демон в тестах не поднимаются — вызовы
 * записываются, статусы подкидываются сценарно.
 */
class FakeTorrentEngine implements TorrentEngine
{
    /** @var list<array{gid:string,dir:string,select:?array,contents:string}> */
    public array $added = [];

    /** @var list<string> */
    public array $removed = [];

    /** @var list<string> */
    public array $purged = [];

    /** @var list<string> */
    public array $paused = [];

    /** @var list<string> */
    public array $resumed = [];

    /** @var array<string, array{status:string,total:int,completed:int,rate:int,error:?string}> */
    public array $statuses = [];

    /** @var list<array{gid:string,options:array}> */
    public array $changed = [];

    private int $seq = 0;

    public function addTorrent(string $contents, string $dir, ?array $selectIndexes = null, int $maxDownloadRate = 0): string
    {
        $gid = 'gid-'.(++$this->seq);
        $this->added[] = [
            'gid' => $gid,
            'dir' => $dir,
            'select' => $selectIndexes,
            'rate' => $maxDownloadRate,
            'contents' => $contents,
        ];
        $this->statuses[$gid] = [
            'status' => 'active',
            'total' => 100,
            'completed' => 50,
            'rate' => 2048,
            'error' => null,
        ];

        return $gid;
    }

    public function changeOptions(string $gid, array $options): void
    {
        $this->changed[] = ['gid' => $gid, 'options' => $options];
    }

    public function status(string $gid): array
    {
        if (! isset($this->statuses[$gid])) {
            throw new \RuntimeException('aria2: aria2.tellStatus — not found');
        }

        return $this->statuses[$gid];
    }

    public function pause(string $gid): void
    {
        $this->paused[] = $gid;
    }

    public function resume(string $gid): void
    {
        $this->resumed[] = $gid;
    }

    public function remove(string $gid): void
    {
        $this->removed[] = $gid;
    }

    public function purge(string $gid): void
    {
        $this->purged[] = $gid;
    }
}

class TorrentApiTest extends TestCase
{
    use RefreshDatabase;

    private FakeTorrentEngine $engine;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake('torrents');
        $this->engine = new FakeTorrentEngine;
        $this->app->instance(TorrentEngine::class, $this->engine);
    }

    private function torrentUpload(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent(
            'sample.torrent',
            file_get_contents(__DIR__.'/../fixtures/sample.torrent'),
        );
    }

    private function upload(User $user, ?Folder $folder = null): TestResponse
    {
        return $this->actingAs($user)->post('/api/files', array_filter([
            'file' => $this->torrentUpload(),
            'folder_id' => $folder?->id,
        ]));
    }

    public function test_auto_mode_starts_download_immediately(): void
    {
        $user = User::factory()->create();
        $res = $this->upload($user);

        $res->assertCreated();
        $torrent = Torrent::firstOrFail();
        $this->assertSame(Torrent::STATUS_DOWNLOADING, $torrent->status);
        $this->assertSame('gid-1', $torrent->gid);
        $this->assertSame('7f5e8aa800973aa6f4aa721153b5008e9d43c09f', $torrent->info_hash);
        $this->assertSame('Test Release', $torrent->name);
        $this->assertSame(2648, $torrent->total_size);
        $this->assertNull($this->engine->added[0]['select']);
        // Файл-карточка отдаёт сокращённый torrent-payload.
        $this->assertSame(
            Torrent::STATUS_DOWNLOADING,
            $res->json('data.torrent.status'),
        );
    }

    public function test_manual_mode_waits_for_selection(): void
    {
        $user = User::factory()->create();
        $folder = Folder::create([
            'user_id' => $user->id,
            'name' => 'Manual',
            'torrent_mode' => 'manual',
        ]);

        $this->upload($user, $folder)->assertCreated();

        $torrent = Torrent::firstOrFail();
        $this->assertSame(Torrent::STATUS_AWAITING_SELECTION, $torrent->status);
        $this->assertSame($folder->id, $torrent->folder_id);
        $this->assertNull($torrent->gid);
        $this->assertSame([], $this->engine->added);
        $this->assertCount(3, $torrent->files);

        $this->actingAs($user)->getJson("/api/torrents/{$torrent->id}")
            ->assertOk()
            ->assertJsonPath('name', 'Test Release')
            ->assertJsonPath('files.1.path', 'docs/file.pdf')
            ->assertJsonPath('files.1.size', 2048);
    }

    public function test_start_downloads_only_selected_files(): void
    {
        $user = User::factory()->create();
        $folder = Folder::create([
            'user_id' => $user->id,
            'name' => 'Manual',
            'torrent_mode' => 'manual',
        ]);
        $this->upload($user, $folder)->assertCreated();
        $torrent = Torrent::firstOrFail();

        $this->actingAs($user)
            ->postJson("/api/torrents/{$torrent->id}/start", ['file_indexes' => [1, 2, 999]])
            ->assertOk()
            ->assertJsonPath('status', Torrent::STATUS_DOWNLOADING);

        // 999 отфильтрован, в движок ушли только валидные индексы.
        $this->assertSame([1, 2], $this->engine->added[0]['select']);

        $torrent->refresh();
        $selected = collect($torrent->files)->pluck('selected', 'index');
        $this->assertFalse($selected[0]);
        $this->assertTrue($selected[1]);
        $this->assertTrue($selected[2]);
    }

    public function test_settings_persist_and_drive_start(): void
    {
        $user = User::factory()->create();
        $folder = Folder::create([
            'user_id' => $user->id,
            'name' => 'Manual',
            'torrent_mode' => 'manual',
        ]);
        $this->upload($user, $folder)->assertCreated();
        $torrent = Torrent::firstOrFail();

        // Сохраняем выбор и лимит — пока awaiting_selection движок не дёргается.
        $this->actingAs($user)->putJson("/api/torrents/{$torrent->id}/settings", [
            'file_indexes' => [0, 2],
            'max_download_rate' => 5 * 1048576,
        ])->assertOk();

        $s = TorrentSetting::firstOrFail();
        $this->assertSame([0, 2], $s->selected_indexes);
        $this->assertSame(5 * 1048576, $s->max_download_rate);
        $this->assertSame([], $this->engine->added);

        // Старт без параметров берёт выбор и лимит из настроек.
        $this->actingAs($user)->postJson("/api/torrents/{$torrent->id}/start", [])->assertOk();
        $this->assertSame([0, 2], $this->engine->added[0]['select']);
        $this->assertSame(5 * 1048576, $this->engine->added[0]['rate']);
    }

    public function test_settings_apply_live_to_running_download(): void
    {
        $user = User::factory()->create();
        $this->upload($user)->assertCreated();
        $torrent = Torrent::firstOrFail(); // downloading, gid-1

        $this->actingAs($user)->putJson("/api/torrents/{$torrent->id}/settings", [
            'file_indexes' => [1],
            'max_download_rate' => 1048576,
        ])->assertOk();

        // changeOption живой задаче: select-file 1-based, лимит строкой.
        $this->assertSame('gid-1', $this->engine->changed[0]['gid']);
        $this->assertSame('2', $this->engine->changed[0]['options']['select-file']);
        $this->assertSame('1048576', $this->engine->changed[0]['options']['max-download-limit']);
        $this->assertSame([1], $torrent->fresh()->settings->selected_indexes);
    }

    public function test_settings_on_completed_torrent_starts_pending_download(): void
    {
        $user = User::factory()->create();
        $folder = Folder::create([
            'user_id' => $user->id,
            'name' => 'Manual',
            'torrent_mode' => 'manual',
        ]);
        $this->upload($user, $folder)->assertCreated();
        $torrent = Torrent::firstOrFail();

        // Качаем только файл 0 → complete → done выставлен у него одного.
        $this->actingAs($user)
            ->postJson("/api/torrents/{$torrent->id}/start", ['file_indexes' => [0]])
            ->assertOk();
        $dir = (string) $torrent->id;
        Storage::disk('torrents')->put("{$dir}/{$torrent->files[0]['path']}", 'data');
        $torrent->refresh();
        $this->engine->statuses[$torrent->gid] = [
            'status' => 'complete', 'total' => 2648, 'completed' => 600, 'rate' => 0, 'error' => null,
        ];
        app(TorrentService::class)->poll($torrent->fresh());
        $torrent->refresh();
        $this->assertSame(Torrent::STATUS_COMPLETED, $torrent->status);
        $resultFolder = $torrent->result_folder_id;
        $byIndex = collect($torrent->files)->keyBy('index');
        $this->assertTrue($byIndex[0]['done'] ?? false);
        $this->assertFalse($byIndex[1]['done'] ?? false);

        // Новый выбор + файл 1 → автостарт докачки только его.
        $this->actingAs($user)->putJson("/api/torrents/{$torrent->id}/settings", [
            'file_indexes' => [0, 1],
        ])->assertOk()->assertJsonPath('status', Torrent::STATUS_DOWNLOADING);
        $this->assertSame([1], $this->engine->added[1]['select']);

        // Повторный finalize сливается в ту же result-папку.
        $torrent->refresh();
        Storage::disk('torrents')->put("{$dir}/{$torrent->files[1]['path']}", 'data');
        $this->engine->statuses[$torrent->gid] = [
            'status' => 'complete', 'total' => 2648, 'completed' => 2648, 'rate' => 0, 'error' => null,
        ];
        app(TorrentService::class)->poll($torrent->fresh());
        $this->assertSame($resultFolder, $torrent->fresh()->result_folder_id);
        // Выбранные [0,1] докачаны и слиты в ту же папку; файл 2 не трогали.
        $done = collect($torrent->fresh()->files)->pluck('done', 'index');
        $this->assertTrue($done[0]);
        $this->assertTrue($done[1]);
        $this->assertFalse($done[2]);
    }

    public function test_pause_and_resume(): void
    {
        $user = User::factory()->create();
        $this->upload($user)->assertCreated();
        $torrent = Torrent::firstOrFail();

        $this->actingAs($user)->postJson("/api/torrents/{$torrent->id}/pause")
            ->assertOk()
            ->assertJsonPath('status', Torrent::STATUS_PAUSED);
        $this->assertSame(['gid-1'], $this->engine->paused);

        $this->actingAs($user)->postJson("/api/torrents/{$torrent->id}/resume")
            ->assertOk()
            ->assertJsonPath('status', Torrent::STATUS_DOWNLOADING);
        $this->assertSame(['gid-1'], $this->engine->resumed);
    }

    public function test_foreign_torrent_is_forbidden(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $this->upload($owner)->assertCreated();
        $torrent = Torrent::firstOrFail();

        $this->actingAs($other)->getJson("/api/torrents/{$torrent->id}")->assertForbidden();
        $this->actingAs($other)->postJson("/api/torrents/{$torrent->id}/start", [])->assertForbidden();
        $this->actingAs($other)->postJson("/api/torrents/{$torrent->id}/pause")->assertForbidden();
        $this->actingAs($other)->deleteJson("/api/torrents/{$torrent->id}")->assertForbidden();
    }

    public function test_poller_updates_progress_and_speed(): void
    {
        $user = User::factory()->create();
        $this->upload($user)->assertCreated();
        $torrent = Torrent::firstOrFail();

        $this->engine->statuses['gid-1'] = [
            'status' => 'active', 'total' => 2648, 'completed' => 1324, 'rate' => 1048576, 'error' => null,
        ];
        // Напрямую poll: artisan-команда крутит цикл ~50 сек, пока
        // есть активные торренты — в тесте это только замедлит прогон.
        app(TorrentService::class)->poll($torrent);

        $torrent->refresh();
        $this->assertSame(50, $torrent->progress);
        $this->assertSame(1048576, $torrent->download_rate);
        $this->assertSame(1324, $torrent->downloaded_size);
    }

    public function test_log_collects_events_and_show_returns_engine_stats(): void
    {
        $user = User::factory()->create();
        $this->upload($user)->assertCreated();
        $torrent = Torrent::firstOrFail();

        // Старт уже записал строку в журнал.
        $this->assertNotEmpty($torrent->log);
        $this->assertStringContainsString('Загрузка запущена', $torrent->log[0]['m']);

        $this->engine->statuses['gid-1'] = [
            'status' => 'active', 'total' => 2648, 'completed' => 1324, 'rate' => 1048576,
            'error' => null, 'seeds' => 4, 'peers' => 12, 'upload_rate' => 0,
        ];
        $this->travel(31)->seconds();
        app(TorrentService::class)->poll($torrent);

        $torrent->refresh();
        $this->assertStringContainsString('сиды 4', $torrent->log[1]['m']);
        $this->assertStringContainsString('пиры 12', $torrent->log[1]['m']);

        $this->actingAs($user)->getJson("/api/torrents/{$torrent->id}")
            ->assertOk()
            ->assertJsonCount(2, 'log')
            ->assertJsonPath('engine.seeds', 4)
            ->assertJsonPath('engine.peers', 12)
            ->assertJsonPath('engine.download_rate', 1048576);
    }

    public function test_finalize_moves_files_into_result_folder(): void
    {
        $user = User::factory()->create();
        $parent = Folder::create([
            'user_id' => $user->id,
            'name' => 'Incoming',
            'default_ttl_days' => 30,
            'conversion_enabled' => false,
        ]);
        $this->upload($user, $parent)->assertCreated();
        $torrent = Torrent::firstOrFail();

        // Движок «скачал» все три файла в staging-каталог задачи.
        $dir = $torrent->id;
        Storage::disk('torrents')->put("{$dir}/video.bin", 'video-data');
        Storage::disk('torrents')->put("{$dir}/docs/file.pdf", 'pdf-data');
        Storage::disk('torrents')->put("{$dir}/docs/sub/nested.txt", 'txt-data');
        $this->engine->statuses['gid-1'] = [
            'status' => 'complete', 'total' => 2648, 'completed' => 2648, 'rate' => 0, 'error' => null,
        ];

        $this->artisan('torrents:poll')->assertSuccessful();

        $torrent->refresh();
        $this->assertSame(Torrent::STATUS_COMPLETED, $torrent->status);
        $this->assertSame(100, $torrent->progress);
        $this->assertNull($torrent->gid);
        $this->assertSame(['gid-1'], $this->engine->purged);
        $this->assertSame([], Storage::disk('torrents')->allFiles((string) $torrent->id));

        // Result-папка рядом с .torrent, структура торрента воспроизведена.
        $result = Folder::findOrFail($torrent->result_folder_id);
        $this->assertSame('Test Release', $result->name);
        $this->assertSame($parent->id, $result->parent_id);
        $this->assertSame(30, $result->default_ttl_days);
        $this->assertFalse($result->conversion_enabled);

        $rootFile = StoredFile::where('folder_id', $result->id)->where('name', 'video.bin')->firstOrFail();
        Storage::disk('public')->assertExists($rootFile->path);
        $this->assertSame('video-data', Storage::disk('public')->get($rootFile->path));

        $docs = Folder::where('parent_id', $result->id)->where('name', 'docs')->firstOrFail();
        $this->assertTrue(StoredFile::where('folder_id', $docs->id)->where('name', 'file.pdf')->exists());
        $sub = Folder::where('parent_id', $docs->id)->where('name', 'sub')->firstOrFail();
        $this->assertTrue(StoredFile::where('folder_id', $sub->id)->where('name', 'nested.txt')->exists());
    }

    public function test_broken_torrent_becomes_error(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->post('/api/files', [
            'file' => UploadedFile::fake()->createWithContent('broken.torrent', 'garbage!!!'),
        ])->assertCreated();

        $torrent = Torrent::firstOrFail();
        $this->assertSame(Torrent::STATUS_ERROR, $torrent->status);
        $this->assertNotNull($torrent->error);
        $this->assertSame([], $this->engine->added);
    }

    public function test_trashing_torrent_file_cancels_download(): void
    {
        $user = User::factory()->create();
        $this->upload($user)->assertCreated();
        $torrent = Torrent::firstOrFail();
        $file = StoredFile::firstOrFail();

        $this->actingAs($user)->deleteJson("/api/files/{$file->id}")->assertOk();

        $this->assertSame(['gid-1'], $this->engine->removed);
        $this->assertSame(0, Torrent::count());
    }

    public function test_delete_torrent_only_keeps_data(): void
    {
        $user = User::factory()->create();
        $this->upload($user)->assertCreated();
        $torrent = Torrent::firstOrFail();
        $file = StoredFile::firstOrFail();

        $this->actingAs($user)->deleteJson("/api/torrents/{$torrent->id}")
            ->assertOk();

        $this->assertSame(0, Torrent::count());
        $this->assertNotNull(StoredFile::find($file->id)); // .torrent на месте
        $this->assertSame(['gid-1'], $this->engine->removed);
    }

    public function test_delete_torrent_with_data_trashes_everything(): void
    {
        $user = User::factory()->create();
        $this->upload($user)->assertCreated();
        $torrent = Torrent::firstOrFail();
        $file = StoredFile::firstOrFail();

        // Имитация завершённой загрузки с result-папкой.
        $result = Folder::create(['user_id' => $user->id, 'parent_id' => null, 'name' => 'Test Release']);
        $torrent->update(['result_folder_id' => $result->id]);

        $this->actingAs($user)->deleteJson("/api/torrents/{$torrent->id}?with_data=1")
            ->assertOk();

        $this->assertSame(0, Torrent::count());
        $this->assertNotNull($result->fresh()->deleted_at); // result-папка в корзине
        $this->assertNotNull($file->fresh()->deleted_at);   // .torrent тоже
    }

    public function test_engine_failure_marks_torrent_error(): void
    {
        $user = User::factory()->create();
        $folder = Folder::create([
            'user_id' => $user->id,
            'name' => 'Manual',
            'torrent_mode' => 'manual',
        ]);
        $this->upload($user, $folder)->assertCreated();
        $torrent = Torrent::firstOrFail();

        // У движка RPC отвалился — старт не даёт gid, статус error,
        // но сам .torrent загружен успешно.
        $this->app->instance(TorrentEngine::class, new class extends FakeTorrentEngine
        {
            public function addTorrent(string $contents, string $dir, ?array $selectIndexes = null, int $maxDownloadRate = 0): string
            {
                throw new \RuntimeException('aria2: connection refused');
            }
        });

        $this->actingAs($user)
            ->postJson("/api/torrents/{$torrent->id}/start", [])
            ->assertStatus(422);

        $this->assertSame(Torrent::STATUS_ERROR, $torrent->fresh()->status);
    }

    public function test_folder_torrent_mode_validation(): void
    {
        $user = User::factory()->create();
        $folder = Folder::create(['user_id' => $user->id, 'name' => 'F']);

        $this->actingAs($user)->putJson("/api/folders/{$folder->id}", ['torrent_mode' => 'manual'])
            ->assertOk();
        $this->assertSame('manual', $folder->fresh()->torrent_mode);

        $this->actingAs($user)->putJson("/api/folders/{$folder->id}", ['torrent_mode' => 'bogus'])
            ->assertUnprocessable();
    }
}
