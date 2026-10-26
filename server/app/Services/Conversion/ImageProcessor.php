<?php

namespace App\Services\Conversion;

use App\Models\FileDerivative;
use App\Models\StoredFile;

/**
 * Растровые изображения → миниатюра ~300px по ширине (jpeg) для карточки.
 * Работает на GD из PHP-образа — внешних бинарников не нужно.
 */
class ImageProcessor extends FileProcessor
{
    public const THUMB_WIDTH = 300;

    /** Форматы, которые GD умеет декодировать в образе приложения. */
    private const MIMES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/x-ms-bmp',
        'image/avif',
    ];

    public function supports(string $mime): bool
    {
        return in_array($mime, self::MIMES, true);
    }

    public function process(StoredFile $file, callable $progress): void
    {
        $tmp = $this->tempDir($file);
        try {
            $thumbPath = $tmp.'/thumb.jpg';
            static::makeJpegThumbnail($this->sourcePath($file), $thumbPath, self::THUMB_WIDTH);
            $this->storeDerivative($file, $thumbPath, 'thumb.jpg', FileDerivative::KIND_THUMBNAIL, 'image/jpeg');
            $progress(100, null, null);
        } finally {
            $this->cleanDir($tmp);
        }
    }

    /**
     * Уменьшенная jpeg-копия изображения. Используется также для
     * миниатюр первых страниц PDF/Word (общая точка для всех процессоров).
     *
     * @return array{width: int, height: int}
     */
    public static function makeJpegThumbnail(string $source, string $destination, int $maxWidth): array
    {
        $data = @file_get_contents($source);
        $src = $data === false ? false : @imagecreatefromstring($data);
        if ($src === false) {
            throw new ConversionException('Не удалось декодировать изображение (GD).');
        }

        $w = imagesx($src);
        $h = imagesy($src);
        $tw = min($maxWidth, $w);
        $th = max(1, (int) round($h * $tw / $w));

        $dst = imagecreatetruecolor($tw, $th);
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $tw, $th, $w, $h);
        imagejpeg($dst, $destination, 85);
        imagedestroy($src);
        imagedestroy($dst);

        return ['width' => $tw, 'height' => $th];
    }
}
