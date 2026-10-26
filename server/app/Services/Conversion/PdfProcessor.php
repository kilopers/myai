<?php

namespace App\Services\Conversion;

use App\Models\FileDerivative;
use App\Models\StoredFile;

/**
 * PDF → растрирование всех страниц в jpeg через poppler (pdfinfo +
 * pdftoppm) для постраничного просмотрщика + миниатюра первой страницы.
 * Прогресс — доля отрендеренных страниц. Тот же движок переиспользует
 * OfficeProcessor после конвертации doc/docx → pdf.
 */
class PdfProcessor extends FileProcessor
{
    private const DPI = 150;

    public function __construct(private ProcessRunner $runner) {}

    public function supports(string $mime): bool
    {
        return $mime === 'application/pdf';
    }

    public function process(StoredFile $file, callable $progress): void
    {
        $this->renderPages($file, $this->sourcePath($file), $progress);
    }

    /**
     * Растрировать все страницы PDF в производные kind=page + thumbnail.
     * Вызывается и OfficeProcessor'ом для сконвертированного pdf.
     *
     * @param  callable(int, ?int, ?int): void  $progress
     */
    public function renderPages(StoredFile $file, string $pdfPath, callable $progress): void
    {
        $total = $this->pageCount($pdfPath);
        if ($total < 1) {
            throw new ConversionException('pdfinfo: не удалось определить число страниц.');
        }

        $tmp = $this->tempDir($file);
        try {
            for ($n = 1; $n <= $total; $n++) {
                $prefix = $tmp."/page-{$n}";
                $this->runner->run([
                    'pdftoppm', '-f', (string) $n, '-l', (string) $n,
                    '-singlefile', '-jpeg', '-r', (string) self::DPI,
                    $pdfPath, $prefix,
                ]);
                $pagePath = $prefix.'.jpg';
                if (! is_file($pagePath)) {
                    throw new ConversionException("pdftoppm не создал страницу {$n}.");
                }
                // Миниатюра карточки — из первой страницы.
                if ($n === 1) {
                    $thumbPath = $tmp.'/thumb.jpg';
                    ImageProcessor::makeJpegThumbnail($pagePath, $thumbPath, ImageProcessor::THUMB_WIDTH);
                    $this->storeDerivative($file, $thumbPath, 'thumb.jpg', FileDerivative::KIND_THUMBNAIL, 'image/jpeg');
                }
                $this->storeDerivative($file, $pagePath, "page-{$n}.jpg", FileDerivative::KIND_PAGE, 'image/jpeg', $n);
                $progress((int) floor($n * 100 / $total), $n, $total);
            }
        } finally {
            $this->cleanDir($tmp);
        }
    }

    private function pageCount(string $pdfPath): int
    {
        $info = $this->runner->output(['pdfinfo', $pdfPath]);
        if (preg_match('/^Pages:\s+(\d+)/m', $info, $m)) {
            return (int) $m[1];
        }

        return 0;
    }
}
