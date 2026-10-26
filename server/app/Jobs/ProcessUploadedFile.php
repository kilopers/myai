<?php

namespace App\Jobs;

use App\Events\FileConversionUpdated;
use App\Models\StoredFile;
use App\Services\Conversion\ProcessorRegistry;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Фоновая пост-обработка загруженного файла: выбор процессора по mime в
 * ProcessorRegistry, запись производных в file_derivatives, live-прогресс
 * через file.conversion на канале sync.user.{id}. При ошибке — статус
 * failed + текст ошибки в conversion_error (оригинал остаётся доступен).
 */
class ProcessUploadedFile implements ShouldQueue
{
    use Queueable;

    /** Видео конвертируются долго — попытка с запасом по времени. */
    public int $tries = 2;

    public int $timeout = 3600;

    public function __construct(public int $fileId) {}

    public function handle(): void
    {
        // withTrashed: файл может быть в корзине к моменту обработки —
        // производные всё равно нужны (при restore они остаются).
        $file = StoredFile::withTrashed()->find($this->fileId);
        if ($file === null) {
            return;
        }

        $processor = app(ProcessorRegistry::class)->for($file->mime_type);
        if ($processor === null) {
            $file->forceFill(['conversion_status' => 'none'])->save();

            return;
        }

        $file->forceFill([
            'conversion_status' => 'processing',
            'conversion_progress' => 0,
        ])->save();
        $this->broadcast($file, 'processing');

        // Частые колбэки прогресса (ffmpeg шлёт их потоком) схлопываем по
        // целому проценту — иначе broadcast'ы и UPDATE'ы дублируются.
        $lastPct = -1;
        $lastPages = -1;
        $progress = function (int $percent, ?int $pagesDone = null, ?int $pagesTotal = null) use ($file, &$lastPct, &$lastPages): void {
            $percent = max(0, min(100, $percent));
            $pagesKey = ($pagesDone ?? -1) * 100000 + ($pagesTotal ?? -1);
            if ($percent === $lastPct && $pagesKey === $lastPages) {
                return;
            }
            $lastPct = $percent;
            $lastPages = $pagesKey;
            $file->forceFill([
                'conversion_progress' => $percent,
                'pages_done' => $pagesDone,
                'pages_total' => $pagesTotal,
            ])->save();
            $this->broadcast($file, 'processing', $percent, $pagesDone, $pagesTotal);
        };

        $processor->process($file, $progress);

        $file->refresh();
        $file->forceFill([
            'conversion_status' => 'done',
            'conversion_progress' => 100,
        ])->save();
        $this->broadcast($file, 'done', 100, $file->pages_done, $file->pages_total);
    }

    /**
     * Окончательный провал (после всех попыток): статус failed + текст
     * ошибки для отладки. Оригинал остаётся доступен пользователю.
     */
    public function failed(\Throwable $e): void
    {
        $file = StoredFile::withTrashed()->find($this->fileId);
        if ($file === null) {
            return;
        }
        $file->forceFill([
            'conversion_status' => 'failed',
            'conversion_error' => mb_substr($e->getMessage(), 0, 2000),
        ])->save();
        $this->broadcast($file, 'failed', (int) $file->conversion_progress);
    }

    private function broadcast(
        StoredFile $file,
        string $status,
        ?int $progress = null,
        ?int $pagesDone = null,
        ?int $pagesTotal = null,
    ): void {
        event(new FileConversionUpdated($file->user_id, [
            'file_id' => $file->id,
            'status' => $status,
            'progress' => $progress ?? (int) $file->conversion_progress,
            'pages_done' => $pagesDone ?? $file->pages_done,
            'pages_total' => $pagesTotal ?? $file->pages_total,
            'has_derivatives' => $status === 'done' || $file->derivatives()->exists(),
        ]));
    }
}
