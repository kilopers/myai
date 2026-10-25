<?php

namespace App\Support;

class StoragePath
{
    /**
     * Единая двухуровневая раскладка (Moodle-style):
     * files/{ab}/{cd}/{uuid}.{ext}, где ab/cd — 1–4 символы UUID без дефисов.
     * Одинакова для обычных файлов и скриншотов.
     */
    public static function file(string $uuid, string $extension): string
    {
        $clean = str_replace('-', '', $uuid);

        return 'files/'.substr($clean, 0, 2).'/'.substr($clean, 2, 2).'/'.$uuid.'.'.$extension;
    }
}
