<?php

namespace App\Services\Conversion;

use App\Models\FileDerivative;
use App\Models\StoredFile;
use Illuminate\Support\Facades\Storage;

/**
 * Word (doc/docx) → PDF через LibreOffice headless, затем растрирование
 * страниц движком PdfProcessor — тот же просмотрщик, что и у PDF.
 */
class OfficeProcessor extends FileProcessor
{
    private const MIMES = [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    public function __construct(
        private ProcessRunner $runner,
        private PdfProcessor $pdf,
    ) {}

    public function supports(string $mime): bool
    {
        return in_array($mime, self::MIMES, true);
    }

    public function process(StoredFile $file, callable $progress): void
    {
        $tmp = $this->tempDir($file);
        try {
            // www-data без домашнего каталога — профиль LO держим в tmp.
            $this->runner->run([
                'soffice', '--headless', '--convert-to', 'pdf',
                '--outdir', $tmp, $this->sourcePath($file),
                '-env:UserInstallation=file://'.$tmp.'/lo-profile',
            ], timeout: 600);

            $pdfs = glob($tmp.'/*.pdf') ?: [];
            if ($pdfs === []) {
                throw new ConversionException('LibreOffice не создал PDF.');
            }
            $pdfAbs = $pdfs[0];
            $stored = $this->storeDerivative($file, $pdfAbs, 'converted.pdf', FileDerivative::KIND_PDF, 'application/pdf');

            // Постраничный рендер — тем же движком, что и для PDF.
            $this->pdf->renderPages($file, Storage::disk('public')->path($stored->path), $progress);
        } finally {
            $this->cleanDir($tmp);
        }
    }
}
