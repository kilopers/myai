<?php

namespace Tests\Unit;

use App\Services\Conversion\ImageProcessor;
use App\Services\Conversion\OfficeProcessor;
use App\Services\Conversion\PdfProcessor;
use App\Services\Conversion\ProcessorRegistry;
use App\Services\Conversion\VideoProcessor;
use Tests\TestCase;

class ProcessorRegistryTest extends TestCase
{
    private function registry(): ProcessorRegistry
    {
        return new ProcessorRegistry([
            new ImageProcessor,
            app(PdfProcessor::class),
            app(VideoProcessor::class),
            app(OfficeProcessor::class),
        ]);
    }

    public function test_selects_processor_by_mime(): void
    {
        $registry = $this->registry();

        $this->assertInstanceOf(ImageProcessor::class, $registry->for('image/png'));
        $this->assertInstanceOf(ImageProcessor::class, $registry->for('image/jpeg'));
        $this->assertInstanceOf(PdfProcessor::class, $registry->for('application/pdf'));
        $this->assertInstanceOf(VideoProcessor::class, $registry->for('video/x-matroska'));
        $this->assertInstanceOf(VideoProcessor::class, $registry->for('video/mp4'));
        $this->assertInstanceOf(OfficeProcessor::class, $registry->for('application/msword'));
        $this->assertInstanceOf(OfficeProcessor::class, $registry->for(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ));
    }

    public function test_returns_null_for_unsupported_types(): void
    {
        $registry = $this->registry();

        // svg — GD не растрирует; аудио и прочее — без конвертации.
        $this->assertNull($registry->for('image/svg+xml'));
        $this->assertNull($registry->for('audio/mpeg'));
        $this->assertNull($registry->for('application/zip'));
        $this->assertNull($registry->for('application/octet-stream'));
        $this->assertNull($registry->for(null));
        $this->assertNull($registry->for(''));
    }
}
