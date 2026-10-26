<?php

namespace App\Services\Conversion;

use App\Models\FileDerivative;
use App\Models\StoredFile;
use App\Support\StoragePath;
use Illuminate\Support\Facades\Storage;

/**
 * Процессор пост-обработки загруженного файла. Выбирается реестром
 * (ProcessorRegistry) по mime_type оригинала. Прогресс сообщается
 * колбэком: $progress(int $percent, ?int $pagesDone, ?int $pagesTotal) —
 * percent 0..100, страницы — для постраничных конвертаций.
 */
abstract class FileProcessor
{
    /** Поддерживает ли процессор этот mime-тип. */
    abstract public function supports(string $mime): bool;

    /**
     * Обработать файл и записать производные в file_derivatives.
     *
     * @param  callable(int, ?int, ?int): void  $progress
     *
     * @throws ConversionException
     */
    abstract public function process(StoredFile $file, callable $progress): void;

    /**
     * Сохранить файл с локального диска как производный:
     * derivatives/{ab}/{cd}/{uuid}/{filename} на диске public + запись.
     * Исходный файл удаляется (перенос).
     */
    protected function storeDerivative(
        StoredFile $file,
        string $localPath,
        string $filename,
        string $kind,
        string $mimeType,
        ?int $page = null,
    ): FileDerivative {
        $relative = StoragePath::derivative($file->uuid, $filename);
        $stream = fopen($localPath, 'rb');
        Storage::disk('public')->put($relative, $stream);
        fclose($stream);
        $size = filesize($localPath) ?: 0;
        $dimensions = $this->imageDimensions($localPath, $mimeType);
        unlink($localPath);

        return $file->derivatives()->create([
            'kind' => $kind,
            'page_number' => $page,
            'path' => $relative,
            'mime_type' => $mimeType,
            'size' => $size,
            'width' => $dimensions[0],
            'height' => $dimensions[1],
        ]);
    }

    /**
     * @return array{0: int|null, 1: int|null}
     */
    protected function imageDimensions(string $localPath, string $mimeType): array
    {
        if (! str_starts_with($mimeType, 'image/')) {
            return [null, null];
        }
        $info = @getimagesize($localPath);

        return $info === false ? [null, null] : [$info[0], $info[1]];
    }

    /**
     * Временный каталог для промежуточных файлов конвертации.
     */
    protected function tempDir(StoredFile $file): string
    {
        $dir = sys_get_temp_dir().'/conv-'.$file->uuid;
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        return $dir;
    }

    protected function cleanDir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (glob($dir.'/*') ?: [] as $path) {
            is_dir($path) ? $this->cleanDir($path) : unlink($path);
        }
        rmdir($dir);
    }

    /**
     * Локальный путь оригинала на диске public.
     */
    protected function sourcePath(StoredFile $file): string
    {
        return Storage::disk('public')->path($file->path);
    }
}
