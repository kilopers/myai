<?php

namespace App\Services\Conversion;

use App\Models\FileDerivative;
use App\Models\StoredFile;
use Symfony\Component\Process\Process;

/**
 * Видео → перекодирование в mp4 (H.264 + AAC, faststart) для браузерного
 * плеера + poster-кадр. Прогресс — процент по ffmpeg -progress
 * (out_time_us / duration из ffprobe).
 */
class VideoProcessor extends FileProcessor
{
    public function __construct(private ProcessRunner $runner) {}

    public function supports(string $mime): bool
    {
        return str_starts_with($mime, 'video/');
    }

    public function process(StoredFile $file, callable $progress): void
    {
        $source = $this->sourcePath($file);
        $tmp = $this->tempDir($file);
        try {
            $duration = $this->duration($source);
            $outPath = $tmp.'/converted.mp4';

            $lastPct = -1;
            $this->runner->run([
                'ffmpeg', '-y', '-i', $source,
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                '-progress', 'pipe:1', '-nostats',
                $outPath,
            ], function (string $type, string $buffer) use ($duration, $progress, &$lastPct) {
                if ($type === Process::ERR || $duration <= 0) {
                    return;
                }
                // Блоки вида "out_time_us=1234567" — процент от длительности.
                if (preg_match_all('/out_time_(?:us|ms)=(\d+)/', $buffer, $m)) {
                    $us = (int) end($m[1]);
                    $pct = min(99, (int) floor($us / 1_000_000 / $duration * 100));
                    if ($pct !== $lastPct) {
                        $lastPct = $pct;
                        $progress($pct, null, null);
                    }
                }
            }, timeout: 3600);

            if (! is_file($outPath)) {
                throw new ConversionException('ffmpeg не создал mp4.');
            }
            $this->storeDerivative($file, $outPath, 'converted.mp4', FileDerivative::KIND_VIDEO, 'video/mp4');

            // Poster-кадр (кадр на ~1-й секунде) — превью в карточке и плеере.
            $posterPath = $tmp.'/poster.jpg';
            try {
                $this->runner->run(['ffmpeg', '-y', '-ss', '1', '-i', $source, '-frames:v', '1', '-q:v', '3', $posterPath]);
                if (is_file($posterPath)) {
                    $this->storeDerivative($file, $posterPath, 'poster.jpg', FileDerivative::KIND_POSTER, 'image/jpeg');
                }
            } catch (ConversionException) {
                // Постер опционален — без него видео остаётся рабочим.
            }

            $progress(100, null, null);
        } finally {
            $this->cleanDir($tmp);
        }
    }

    /** Длительность в секундах (0 — неизвестна → indeterminate-прогресс). */
    private function duration(string $source): float
    {
        try {
            $out = $this->runner->output([
                'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1', $source,
            ]);

            return (float) trim($out);
        } catch (ConversionException) {
            return 0.0;
        }
    }
}
