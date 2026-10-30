<?php

namespace App\Support;

/**
 * Минимальный декодер bencode (формат .torrent): строки байт,
 * целые числа, списки и словари. Декодер работает по байтам —
 * «строки» возвращаются как бинарные PHP-строки.
 *
 * Исключение BencodeException выбрасывается при битой структуре.
 */
class Bencode
{
    /**
     * Декодировать значение с позиции $pos.
     *
     * @return array{0: mixed, 1: int} — [значение, позиция за концом значения]
     */
    public static function decodeAt(string $raw, int $pos): array
    {
        $ch = $raw[$pos] ?? '';
        if ($ch === 'i') {
            return self::decodeInt($raw, $pos);
        }
        if ($ch === 'l' || $ch === 'd') {
            return self::decodeList($raw, $pos);
        }
        if ($ch >= '0' && $ch <= '9') {
            return self::decodeString($raw, $pos);
        }

        throw new BencodeException("Неожиданный байт на позиции {$pos}");
    }

    /**
     * Декодировать строку байт "len:data".
     *
     * @return array{0: string, 1: int}
     */
    public static function decodeString(string $raw, int $pos): array
    {
        $colon = strpos($raw, ':', $pos);
        if ($colon === false || $colon - $pos > 20) {
            throw new BencodeException("Битая строка на позиции {$pos}");
        }
        $len = substr($raw, $pos, $colon - $pos);
        if (! ctype_digit($len)) {
            throw new BencodeException("Некорректная длина строки на позиции {$pos}");
        }
        $len = (int) $len;
        $start = $colon + 1;
        if ($start + $len > strlen($raw)) {
            throw new BencodeException('Строка обрезана');
        }

        return [substr($raw, $start, $len), $start + $len];
    }

    /**
     * Декодировать целое "iNNNe".
     *
     * @return array{0: int, 1: int}
     */
    private static function decodeInt(string $raw, int $pos): array
    {
        $end = strpos($raw, 'e', $pos);
        if ($end === false) {
            throw new BencodeException("Незакрытое число на позиции {$pos}");
        }
        $num = substr($raw, $pos + 1, $end - $pos - 1);
        if (! preg_match('/^-?\d+$/', $num)) {
            throw new BencodeException("Некорректное число на позиции {$pos}");
        }

        return [(int) $num, $end + 1];
    }

    /**
     * Декодировать список "l...e" или словарь "d...e" (ключи — строки).
     *
     * @return array{0: array, 1: int}
     */
    private static function decodeList(string $raw, int $pos): array
    {
        $isDict = $raw[$pos] === 'd';
        $result = [];
        $pos++;
        while (true) {
            $ch = $raw[$pos] ?? '';
            if ($ch === '') {
                throw new BencodeException('Список не закрыт');
            }
            if ($ch === 'e') {
                return [$result, $pos + 1];
            }
            if ($isDict) {
                [$key, $pos] = self::decodeString($raw, $pos);
                [$value, $pos] = self::decodeAt($raw, $pos);
                $result[$key] = $value;
            } else {
                [$value, $pos] = self::decodeAt($raw, $pos);
                $result[] = $value;
            }
        }
    }
}
