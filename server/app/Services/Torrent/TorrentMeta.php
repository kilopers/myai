<?php

namespace App\Services\Torrent;

use App\Support\Bencode;
use App\Support\BencodeException;

/**
 * Разбор .torrent-файла: info_hash (SHA-1 от сырого bencode словаря
 * info), имя торрента и список файлов для выборочной загрузки.
 * Класс — результат разбора, создание только через parse().
 */
class TorrentMeta
{
    /**
     * @param  list<array{index:int, path:string, size:int}>  $files
     */
    private function __construct(
        public readonly string $infoHash,
        public readonly string $name,
        public readonly array $files,
        public readonly int $totalSize,
    ) {}

    /**
     * Разобрать сырое содержимое .torrent-файла.
     *
     * @throws BencodeException — при битой структуре или отсутствии info
     */
    public static function parse(string $raw): self
    {
        if (strlen($raw) < 16 || $raw[0] !== 'd') {
            throw new BencodeException('Не .torrent-файл: ожидается словарь');
        }

        // info_hash считается от СЫРЫХ байт словаря info — поэтому
        // верхний уровень разбираем вручную, запоминая офсеты значения.
        $pos = 1;
        $info = null;
        $infoRaw = null;
        while (true) {
            $ch = $raw[$pos] ?? '';
            if ($ch === 'e') {
                break;
            }
            if ($ch === '') {
                throw new BencodeException('Словарь верхнего уровня не закрыт');
            }
            [$key, $pos] = Bencode::decodeString($raw, $pos);
            $start = $pos;
            [$value, $pos] = Bencode::decodeAt($raw, $pos);
            if ($key === 'info') {
                $info = $value;
                $infoRaw = substr($raw, $start, $pos - $start);
            }
        }

        if (! is_array($info) || $infoRaw === null) {
            throw new BencodeException('В .torrent нет словаря info');
        }

        $name = self::text($info['name.utf-8'] ?? $info['name'] ?? null);
        if ($name === null || $name === '') {
            throw new BencodeException('В info нет имени торрента');
        }

        $files = [];
        if (isset($info['files']) && is_array($info['files'])) {
            // Многофайловый торрент: путь — список сегментов.
            foreach ($info['files'] as $i => $f) {
                if (! is_array($f) || ! isset($f['length']) || ! is_int($f['length'])) {
                    throw new BencodeException("Битая запись файла #{$i} в info");
                }
                $segments = $f['path.utf-8'] ?? $f['path'] ?? null;
                if (! is_array($segments) || $segments === []) {
                    throw new BencodeException("Нет пути у файла #{$i} в info");
                }
                $files[] = [
                    'index' => $i,
                    'path' => implode('/', array_map(fn ($s) => self::text($s) ?? '?', $segments)),
                    'size' => $f['length'],
                ];
            }
        } elseif (isset($info['length']) && is_int($info['length'])) {
            // Однофайловый: имя торрента — имя файла.
            $files[] = ['index' => 0, 'path' => $name, 'size' => $info['length']];
        } else {
            throw new BencodeException('В info нет списка файлов');
        }

        return new self(
            infoHash: sha1($infoRaw),
            name: $name,
            files: $files,
            totalSize: array_sum(array_column($files, 'size')),
        );
    }

    /**
     * Байтовая строка → читаемый UTF-8 (невалидные байты заменяются).
     */
    private static function text(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        return mb_convert_encoding($value, 'UTF-8', 'UTF-8');
    }
}
