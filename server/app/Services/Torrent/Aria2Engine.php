<?php

namespace App\Services\Torrent;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * aria2 в режиме демона (--enable-rpc): JSON-RPC поверх HTTP POST на
 * {rpc_url}. Сидирование выключено на уровне демона (seed-time=0) и
 * продублировано опциями каждой задачи — торренты только скачиваются.
 */
class Aria2Engine implements TorrentEngine
{
    public function addTorrent(string $contents, string $dir, ?array $selectIndexes = null): string
    {
        $options = [
            'dir' => $dir,
            'seed-time' => '0',
            'seed-ratio' => '0.0',
        ];
        if ($selectIndexes !== null && $selectIndexes !== []) {
            // aria2 нумерует файлы с 1, у нас — с 0.
            $options['select-file'] = implode(',', array_map(fn (int $i) => $i + 1, $selectIndexes));
        }

        /** @var string $gid */
        $gid = $this->call('aria2.addTorrent', [base64_encode($contents), [], $options]);

        return $gid;
    }

    public function status(string $gid): array
    {
        /** @var array<string, mixed> $st */
        $st = $this->call('aria2.tellStatus', [$gid]);

        $status = match ($st['status'] ?? '') {
            'active', 'waiting' => 'active',
            'paused' => 'paused',
            'complete' => 'complete',
            'removed' => 'removed',
            default => 'error',
        };

        return [
            'status' => $status,
            'total' => (int) ($st['totalLength'] ?? 0),
            'completed' => (int) ($st['completedLength'] ?? 0),
            'rate' => (int) ($st['downloadSpeed'] ?? 0),
            'error' => $status === 'error'
                ? (string) ($st['errorMessage'] ?? $st['errorCode'] ?? 'ошибка движка')
                : null,
        ];
    }

    public function pause(string $gid): void
    {
        $this->call('aria2.forcePause', [$gid]);
    }

    public function resume(string $gid): void
    {
        $this->call('aria2.unpause', [$gid]);
    }

    public function remove(string $gid): void
    {
        try {
            $this->call('aria2.remove', [$gid]);
        } catch (\Throwable) {
            // Уже завершена/удалена — зачищаем запись результата.
        }
        $this->purge($gid);
    }

    public function purge(string $gid): void
    {
        try {
            $this->call('aria2.removeDownloadResult', [$gid]);
        } catch (\Throwable) {
            // Записи может уже не быть (перезапуск демона) — не критично.
        }
    }

    /**
     * Вызов JSON-RPC метода. При secret в конфиге первым параметром
     * идёт токен вида "token:<secret>", как того ждёт aria2.
     *
     * @param  list<mixed>  $params
     */
    private function call(string $method, array $params = []): mixed
    {
        $secret = (string) config('services.torrent.rpc_secret', '');
        if ($secret !== '') {
            array_unshift($params, "token:{$secret}");
        }

        $response = Http::timeout(15)->connectTimeout(5)
            ->post(config('services.torrent.rpc_url'), [
                'jsonrpc' => '2.0',
                'id' => (string) Str::uuid(),
                'method' => $method,
                'params' => $params,
            ]);

        $body = $response->json();
        if (! $response->successful() || isset($body['error'])) {
            $message = is_array($body) ? ($body['error']['message'] ?? 'HTTP '.$response->status()) : 'HTTP '.$response->status();
            throw new \RuntimeException("aria2: {$method} — {$message}");
        }

        return $body['result'] ?? null;
    }
}
