<?php

namespace App\Services;

use App\Models\Board;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * Иконка доски для PWA: кастомная (загруженная картинка) или
 * сгенерированная из prefix/названия. Производные PNG 192/512
 * обычные + maskable складываются на public-диск в
 * board-icons/{id}/ и раздаются публичным роутом BoardPwaController.
 */
class BoardIcon
{
    /** Имена производных файлов, которые отдаёт роут и манифест. */
    public const FILES = [
        'icon-192.png' => ['size' => 192, 'maskable' => false],
        'icon-512.png' => ['size' => 512, 'maskable' => false],
        'maskable-192.png' => ['size' => 192, 'maskable' => true],
        'maskable-512.png' => ['size' => 512, 'maskable' => true],
    ];

    // Палитра фона авто-иконки — та же, что у колонок доски.
    private const COLORS = [
        '#526de3', '#5b8ff9', '#5ad8a6', '#5d7092',
        '#f6bd16', '#e8684a', '#6dc8ec', '#9270ca',
        '#ff9d4d', '#269a99', '#ff99c3', '#a0a8bd',
    ];

    /** Каталог иконок доски на public-диске. */
    public static function dir(Board $board): string
    {
        return "board-icons/{$board->id}";
    }

    /** Загрузка своей картинки: источник + все производные PNG. */
    public function storeUpload(Board $board, UploadedFile $file): void
    {
        $src = @imagecreatefromstring($file->get());
        abort_unless($src !== false, 422, 'Не удалось прочитать изображение');

        $board->update(['icon' => self::dir($board).'/src']);
        Storage::disk('public')->put($board->icon, $file->get());
        $this->generate($board);
    }

    /** Сброс к авто-иконке из prefix/названия. */
    public function reset(Board $board): void
    {
        $board->update(['icon' => null]);
        $this->generate($board);
    }

    /** Удаление всех файлов иконки (при удалении доски). */
    public function deleteFiles(Board $board): void
    {
        Storage::disk('public')->deleteDirectory(self::dir($board));
    }

    /**
     * Генерирует все производные PNG: из загруженного источника
     * (boards.icon) или буквенную иконку из prefix/названия.
     */
    public function generate(Board $board): void
    {
        $src = $board->icon && Storage::disk('public')->exists($board->icon)
            ? @imagecreatefromstring(Storage::disk('public')->get($board->icon))
            : null;

        foreach (self::FILES as $file => $cfg) {
            $png = $src ? $this->fromImage($src, $cfg['size'], $cfg['maskable'])
                : $this->fromLetter($board, $cfg['size'], $cfg['maskable']);
            Storage::disk('public')->put(self::dir($board)."/{$file}", $png);
        }
    }

    /** Квадратная обрезка + ресайз; maskable — логотип 76% на фоне угла. */
    private function fromImage(\GdImage $src, int $size, bool $maskable): string
    {
        $w = imagesx($src);
        $h = imagesy($src);
        $dst = imagecreatetruecolor($size, $size);
        imagealphablending($dst, false);
        imagesavealpha($dst, true);

        if ($maskable) {
            // Фон — цвет углового пикселя, картинка уменьшена до 76%
            $bg = imagecolorat($src, 0, 0);
            imagefill($dst, 0, 0, $bg);
            $inner = (int) round($size * 0.76);
            $off = (int) (($size - $inner) / 2);
            $side = min($w, $h);
            imagecopyresampled($dst, $src, $off, $off, ($w - $side) / 2, ($h - $side) / 2, $inner, $inner, $side, $side);
        } else {
            $side = min($w, $h);
            imagecopyresampled($dst, $src, 0, 0, ($w - $side) / 2, ($h - $side) / 2, $size, $size, $side, $side);
        }

        return $this->png($dst);
    }

    /** Буквенная иконка: цветной фон из палитры + буквы prefix/имени. */
    private function fromLetter(Board $board, int $size, bool $maskable): string
    {
        $img = imagecreatetruecolor($size, $size);
        $color = self::COLORS[crc32((string) $board->name) % count(self::COLORS)];
        [$r, $g, $b] = sscanf($color, '#%02x%02x%02x');
        $bg = imagecolorallocate($img, $r, $g, $b);
        imagefill($img, 0, 0, $bg);

        $text = $board->prefix
            ? mb_substr($board->prefix, 0, 2)
            : mb_strtoupper(mb_substr(trim($board->name), 0, 1));

        $font = resource_path('fonts/DejaVuSans-Bold.ttf');
        // maskable: буквы меньше — в «безопасной зоне» круга обрезки
        $fontSize = (int) round($size * ($maskable ? 0.34 : 0.44));
        $box = imagettfbbox($fontSize, 0, $font, $text);
        // Грубое центрирование по метрикам: box[0]/box[2] — лево/право
        // от точки пера, box[7]/box[1] — верх/низ от базовой линии.
        $x = (int) round($size / 2 - ($box[0] + $box[2]) / 2);
        $y = (int) round($size / 2 - ($box[7] + $box[1]) / 2);
        $white = imagecolorallocate($img, 255, 255, 255);
        imagettftext($img, $fontSize, 0, $x, $y, $white, $font, $text);

        // Метрики шрифта шире реального ink-бокса (несимметричные
        // боковые bearings) — измеряем пиксели и докручиваем сдвигом.
        [$dx, $dy] = $this->inkShift($img, $bg, $size);
        if ($dx !== 0 || $dy !== 0) {
            imagefill($img, 0, 0, $bg);
            imagettftext($img, $fontSize, 0, $x + $dx, $y + $dy, $white, $font, $text);
        }

        return $this->png($img);
    }

    /** Сдвиг, центрирующий реальный ink-бокс (замер по пикселям, шаг 2). */
    private function inkShift(\GdImage $img, int $bg, int $size): array
    {
        $minX = $minY = $size;
        $maxX = $maxY = -1;
        for ($yy = 0; $yy < $size; $yy += 2) {
            for ($xx = 0; $xx < $size; $xx += 2) {
                if (imagecolorat($img, $xx, $yy) !== $bg) {
                    $minX = min($minX, $xx);
                    $maxX = max($maxX, $xx);
                    $minY = min($minY, $yy);
                    $maxY = max($maxY, $yy);
                }
            }
        }
        if ($maxX < 0) {
            return [0, 0];
        }

        return [
            (int) round($size / 2 - ($minX + $maxX) / 2),
            (int) round($size / 2 - ($minY + $maxY) / 2),
        ];
    }

    private function png(\GdImage $img): string
    {
        ob_start();
        imagepng($img);
        $data = ob_get_clean();
        imagedestroy($img);

        return (string) $data;
    }
}
