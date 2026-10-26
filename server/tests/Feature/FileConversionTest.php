<?php

namespace Tests\Feature;

use App\Events\FileConversionUpdated;
use App\Jobs\ProcessUploadedFile;
use App\Models\DeletedFile;
use App\Models\FileDerivative;
use App\Models\StoredFile;
use App\Models\User;
use App\Services\Conversion\FileProcessor;
use App\Services\Conversion\PdfProcessor;
use App\Services\Conversion\ProcessorRegistry;
use App\Services\Conversion\ProcessRunner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class FileConversionTest extends TestCase
{
    use RefreshDatabase;

    private function makeFile(User $user, array $attrs = []): StoredFile
    {
        return StoredFile::create(array_merge([
            'user_id' => $user->id,
            'uuid' => (string) Str::uuid(),
            'name' => 'doc.bin',
            'filename' => 'doc.bin',
            'mime_type' => 'application/octet-stream',
            'size' => 100,
            'path' => 'files/ab/cd/'.(string) Str::uuid().'.bin',
            'mtime' => 1700000000,
        ], $attrs));
    }

    private function makeDerivative(StoredFile $file, array $attrs = []): FileDerivative
    {
        $path = $attrs['path'] ?? 'derivatives/ab/cd/'.$file->uuid.'/'.uniqid('d').'.jpg';
        Storage::disk('public')->put($path, 'binary');

        return $file->derivatives()->create(array_merge([
            'kind' => FileDerivative::KIND_PAGE,
            'page_number' => 1,
            'path' => $path,
            'mime_type' => 'image/jpeg',
            'size' => 6,
        ], Arr::except($attrs, 'path')));
    }

    public function test_image_upload_dispatches_conversion_job(): void
    {
        Storage::fake('public');
        Queue::fake(); // джоба не исполняется — проверяем сам факт диспатча

        $user = User::factory()->create();
        $res = $this->actingAs($user)->post('/api/files', [
            'file' => UploadedFile::fake()->image('pic.png', 640, 480),
        ]);

        $res->assertCreated();
        $this->assertSame('pending', StoredFile::firstOrFail()->conversion_status);
        Queue::assertPushed(ProcessUploadedFile::class);
    }

    public function test_image_job_runs_to_done_with_real_gd(): void
    {
        Storage::fake('public');
        Event::fake([FileConversionUpdated::class]);
        $user = User::factory()->create();

        $path = 'files/ab/cd/'.Str::uuid().'.png';
        $png = (function () {
            $img = imagecreatetruecolor(640, 480);
            ob_start();
            imagepng($img);
            imagedestroy($img);

            return ob_get_clean();
        })();
        Storage::disk('public')->put($path, $png);
        $file = $this->makeFile($user, ['mime_type' => 'image/png', 'name' => 'pic.png', 'path' => $path]);

        (new ProcessUploadedFile($file->id))->handle();

        $file->refresh();
        $this->assertSame('done', $file->conversion_status);
        $this->assertSame(100, $file->conversion_progress);

        $thumb = $file->derivatives()->where('kind', FileDerivative::KIND_THUMBNAIL)->firstOrFail();
        $this->assertSame('image/jpeg', $thumb->mime_type);
        $this->assertSame(300, $thumb->width);
        Storage::disk('public')->assertExists($thumb->path);

        Event::assertDispatched(
            FileConversionUpdated::class,
            fn (FileConversionUpdated $e) => $e->broadcastAs() === 'file.conversion'
                && $e->payload['file_id'] === $file->id
                && $e->payload['status'] === 'done',
        );
    }

    public function test_file_without_processor_gets_status_none(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();

        $res = $this->actingAs($user)->post('/api/files', [
            'file' => UploadedFile::fake()->createWithContent('x.bin', 'data'),
        ]);

        $res->assertCreated();
        $this->assertSame('none', StoredFile::firstOrFail()->conversion_status);
        $this->assertSame(0, FileDerivative::count());
    }

    public function test_thumbnail_and_pages_endpoints(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user, ['mime_type' => 'application/pdf', 'name' => 'doc.pdf']);

        $thumb = $this->makeDerivative($file, ['kind' => FileDerivative::KIND_THUMBNAIL, 'page_number' => null]);
        $p1 = $this->makeDerivative($file, ['kind' => FileDerivative::KIND_PAGE, 'page_number' => 1]);
        $this->makeDerivative($file, ['kind' => FileDerivative::KIND_PAGE, 'page_number' => 2]);

        $this->actingAs($user)->getJson("/api/files/{$file->id}/thumbnail")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg');

        $this->actingAs($user)->getJson("/api/files/{$file->id}/pages")
            ->assertOk()
            ->assertJsonPath('count', 2);

        $this->actingAs($user)->getJson("/api/files/{$file->id}/pages/1")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg');

        $this->actingAs($user)->getJson("/api/files/{$file->id}/pages/5")->assertNotFound();
        $this->assertNotNull($thumb);
        $this->assertNotNull($p1);
    }

    public function test_converted_streams_mp4_with_range_support(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user, ['mime_type' => 'video/x-matroska', 'name' => 'clip.mkv']);
        $video = $this->makeDerivative($file, [
            'kind' => FileDerivative::KIND_VIDEO,
            'page_number' => null,
            'mime_type' => 'video/mp4',
            'path' => 'derivatives/ab/cd/'.$file->uuid.'/converted.mp4',
        ]);
        Storage::disk('public')->put($video->path, str_repeat('v', 2048));

        $res = $this->actingAs($user)->get("/api/files/{$file->id}/converted");
        $res->assertOk()
            ->assertHeader('Content-Type', 'video/mp4')
            ->assertHeader('Accept-Ranges', 'bytes');

        $ranged = $this->actingAs($user)->get("/api/files/{$file->id}/converted", [
            'Range' => 'bytes=0-99',
        ]);
        $ranged->assertStatus(206)
            ->assertHeader('Content-Range', 'bytes 0-99/2048');
    }

    public function test_derivatives_endpoints_forbidden_for_other_users(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $other = User::factory()->create();
        $file = $this->makeFile($user);
        $this->makeDerivative($file, ['kind' => FileDerivative::KIND_THUMBNAIL]);

        $this->actingAs($other)->getJson("/api/files/{$file->id}/thumbnail")->assertForbidden();
        $this->actingAs($other)->getJson("/api/files/{$file->id}/pages")->assertForbidden();
        $this->actingAs($other)->getJson("/api/files/{$file->id}/pages/1")->assertForbidden();
        $this->actingAs($other)->getJson("/api/files/{$file->id}/converted")->assertForbidden();
    }

    public function test_derivatives_do_not_affect_sync_tree_and_hashes(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user, ['name' => 'a.pdf']);
        Storage::disk('public')->put($file->path, 'pdf');

        $before = $this->actingAs($user)->getJson('/api/sync/tree')->assertOk();
        $rootHash = $before->json('root_hash');
        $this->assertCount(1, $before->json('entries'));

        $this->makeDerivative($file, ['kind' => FileDerivative::KIND_THUMBNAIL]);
        $this->makeDerivative($file, ['kind' => FileDerivative::KIND_PAGE, 'page_number' => 1]);

        $after = $this->actingAs($user)->getJson('/api/sync/tree')->assertOk();
        $this->assertSame($rootHash, $after->json('root_hash'));
        $this->assertCount(1, $after->json('entries'));
        $this->assertSame('a.pdf', $after->json('entries.0.name'));

        // tombstone'ов для производных нет
        $this->assertDatabaseMissing('deleted_files', ['name' => 'thumb.jpg']);
    }

    public function test_trash_keeps_derivatives_and_restore_works(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user);
        Storage::disk('public')->put($file->path, 'data');
        $thumb = $this->makeDerivative($file, ['kind' => FileDerivative::KIND_THUMBNAIL]);

        $this->actingAs($user)->deleteJson("/api/files/{$file->id}")->assertOk();

        // В корзине производные живы — restore сохраняет их.
        $this->assertDatabaseHas('file_derivatives', ['id' => $thumb->id]);
        Storage::disk('public')->assertExists($thumb->path);

        $this->actingAs($user)->postJson("/api/trash/file/{$file->id}/restore")->assertOk();
        $this->assertNull($file->fresh()->deleted_at);
        $this->assertDatabaseHas('file_derivatives', ['id' => $thumb->id]);
        Storage::disk('public')->assertExists($thumb->path);
    }

    public function test_purge_removes_derivative_files_and_rows(): void
    {
        Storage::fake('public');
        $user = User::factory()->create();
        $file = $this->makeFile($user);
        Storage::disk('public')->put($file->path, 'data');
        $thumb = $this->makeDerivative($file, ['kind' => FileDerivative::KIND_THUMBNAIL]);
        $page = $this->makeDerivative($file, ['kind' => FileDerivative::KIND_PAGE, 'page_number' => 1]);

        $this->actingAs($user)->deleteJson("/api/files/{$file->id}")->assertOk();
        $this->actingAs($user)->deleteJson("/api/trash/file/{$file->id}")->assertOk();

        $this->assertDatabaseMissing('files', ['id' => $file->id]);
        $this->assertDatabaseMissing('file_derivatives', ['file_id' => $file->id]);
        Storage::disk('public')->assertMissing($file->path);
        Storage::disk('public')->assertMissing($thumb->path);
        Storage::disk('public')->assertMissing($page->path);
        // tombstone только у оригинала
        $this->assertSame(1, DeletedFile::where('kind', 'file')->count());
    }

    public function test_failed_processor_marks_file_failed(): void
    {
        Storage::fake('public');
        Event::fake([FileConversionUpdated::class]);
        $user = User::factory()->create();
        $file = $this->makeFile($user, ['mime_type' => 'application/pdf', 'conversion_status' => 'pending']);

        $failing = new class extends FileProcessor
        {
            public function supports(string $mime): bool
            {
                return true;
            }

            public function process(StoredFile $file, callable $progress): void
            {
                throw new \RuntimeException('pdftoppm exploded');
            }
        };
        $this->app->instance(ProcessorRegistry::class, new ProcessorRegistry([$failing]));

        $job = new ProcessUploadedFile($file->id);
        try {
            $job->handle();
            $this->fail('handle() должна бросить исключение');
        } catch (\RuntimeException) {
        }
        $job->failed(new \RuntimeException('pdftoppm exploded'));

        $file->refresh();
        $this->assertSame('failed', $file->conversion_status);
        $this->assertSame('pdftoppm exploded', $file->conversion_error);
        Event::assertDispatched(
            FileConversionUpdated::class,
            fn (FileConversionUpdated $e) => $e->payload['status'] === 'failed',
        );
    }

    public function test_pdf_conversion_with_mocked_binaries(): void
    {
        // Внешние бинарники мокаются: runner создаёт «страницы» сам.
        Storage::fake('public');
        $user = User::factory()->create();

        $runner = new class extends ProcessRunner
        {
            public function output(array $command, float $timeout = 120.0): string
            {
                return "Pages: 2\n";
            }

            public function run(array $command, ?callable $onOutput = null, float $timeout = 1800.0): void
            {
                // pdftoppm -singlefile … <pdf> <prefix> → пишем prefix.jpg
                $prefix = end($command);
                $img = imagecreatetruecolor(800, 600);
                imagejpeg($img, $prefix.'.jpg', 85);
                imagedestroy($img);
            }
        };
        $this->app->instance(ProcessRunner::class, $runner);
        $this->app->instance(ProcessorRegistry::class, new ProcessorRegistry([
            app(PdfProcessor::class),
        ]));

        $file = $this->makeFile($user, ['mime_type' => 'application/pdf', 'name' => 'doc.pdf']);
        Storage::disk('public')->put($file->path, '%PDF fake');

        (new ProcessUploadedFile($file->id))->handle();

        $file->refresh();
        $this->assertSame('done', $file->conversion_status);
        $this->assertSame(2, $file->pages_total);
        $this->assertSame(2, $file->pages_done);
        $this->assertSame(2, $file->derivatives()->where('kind', FileDerivative::KIND_PAGE)->count());
        $this->assertDatabaseHas('file_derivatives', [
            'file_id' => $file->id,
            'kind' => FileDerivative::KIND_THUMBNAIL,
        ]);
    }
}
