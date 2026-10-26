<?php

namespace App\Services\Conversion;

/**
 * Реестр процессоров конвертации: выбирает процессор по mime_type.
 * Процессоры разрешаются через контейнер (конструкторы с зависимостями).
 * В тестах реестр собирается с фейковыми процессорами и подменяется
 * через $this->app->instance(ProcessorRegistry::class, ...).
 */
class ProcessorRegistry
{
    /** @param list<FileProcessor>|null $processors */
    public function __construct(private ?array $processors = null) {}

    /**
     * @return list<FileProcessor>
     */
    public function all(): array
    {
        return $this->processors ??= [
            app(ImageProcessor::class),
            app(PdfProcessor::class),
            app(VideoProcessor::class),
            app(OfficeProcessor::class),
        ];
    }

    /**
     * Процессор для mime-типа или null — файлу без процессора ставится
     * conversion_status=none (иконка, без фоновой обработки).
     */
    public function for(?string $mime): ?FileProcessor
    {
        $mime = $mime ?? '';
        foreach ($this->all() as $processor) {
            if ($processor->supports($mime)) {
                return $processor;
            }
        }

        return null;
    }
}
