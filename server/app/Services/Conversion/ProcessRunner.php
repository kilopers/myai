<?php

namespace App\Services\Conversion;

use Symfony\Component\Process\Process;

/**
 * Запуск внешних бинарников конвертации (ffmpeg, ffprobe, pdftoppm,
 * pdfinfo, soffice). В тестах подменяется через контейнер — реальные
 * бинарники в тестовом окружении не вызываются.
 */
class ProcessRunner
{
    /**
     * Выполнить команду, опционально стримя вывод в $onOutput
     * (сигнатура как у Symfony Process: fn(string $type, string $buffer)).
     * Ненулевой код выхода → ConversionException с stderr в сообщении.
     *
     * @param  list<string>  $command
     * @param  callable(string, string): void|null  $onOutput
     */
    public function run(array $command, ?callable $onOutput = null, float $timeout = 1800.0): void
    {
        $process = $this->make($command, $timeout);
        $process->run($onOutput);
        $this->assertSuccessful($process);
    }

    /**
     * Выполнить команду и вернуть stdout (для pdfinfo/ffprobe).
     *
     * @param  list<string>  $command
     */
    public function output(array $command, float $timeout = 120.0): string
    {
        $process = $this->make($command, $timeout);
        $process->run();
        $this->assertSuccessful($process);

        return $process->getOutput();
    }

    /**
     * @param  list<string>  $command
     */
    protected function make(array $command, float $timeout): Process
    {
        $process = new Process($command);
        $process->setTimeout($timeout);

        return $process;
    }

    protected function assertSuccessful(Process $process): void
    {
        if (! $process->isSuccessful()) {
            $cmd = $process->getCommandLine();
            $err = trim($process->getErrorOutput()) ?: trim($process->getOutput());

            throw new ConversionException("{$cmd}: {$err}");
        }
    }
}
