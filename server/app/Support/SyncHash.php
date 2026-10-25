<?php

namespace App\Support;

use App\Models\Folder;
use App\Models\Screenshot;
use App\Models\User;

/**
 * Хэши дерева синхронизации. Содержимое файлов не читается — только
 * метаданные. Формулы (реализация в desktop/src-tauri/src/sync.rs
 * обязана совпадать побитово, паритет проверен общими тест-векторами):
 *
 *   файл:  entry_hash = sha256("{name}|{size}|{mtime_unix}")
 *   папка: entry_hash = sha256("{name}|0|{dir_hash}")
 *   dir_hash(папка) = sha256(concat(entry_hash детей))
 *                     дети отсортированы по name в byte-order (strcmp).
 *
 * Изменение листа пересчитывает хэши всех предков до корня (Merkle).
 */
class SyncHash
{
    public static function file(string $name, int $size, ?int $mtime): string
    {
        return hash('sha256', $name.'|'.$size.'|'.($mtime ?? 0));
    }

    public static function folderEntry(string $name, string $dirHash): string
    {
        return hash('sha256', $name.'|0|'.$dirHash);
    }

    /**
     * @param  iterable<array{name: string, hash: string}>  $children
     */
    public static function dir(iterable $children): string
    {
        $items = [];
        foreach ($children as $child) {
            $items[] = $child;
        }
        usort($items, fn (array $a, array $b) => strcmp($a['name'], $b['name']));

        return hash('sha256', implode('', array_map(fn (array $c) => $c['hash'], $items)));
    }

    /**
     * Дети папки для вычисления dir_hash: подпапки + файлы,
     * у системной папки «Скриншоты» — ещё и сами скриншоты.
     *
     * @return list<array{name: string, hash: string}>
     */
    public static function folderChildren(Folder $folder): array
    {
        $children = [];

        foreach ($folder->children as $child) {
            $children[] = [
                'name' => $child->name,
                'hash' => self::folderEntry($child->name, $child->dirHash()),
            ];
        }
        foreach ($folder->files as $file) {
            $children[] = ['name' => $file->name, 'hash' => $file->entryHash()];
        }
        if ($folder->is_system) {
            $shots = Screenshot::where('user_id', $folder->user_id)->get();
            foreach ($shots as $shot) {
                $children[] = ['name' => $shot->filename, 'hash' => $shot->entryHash()];
            }
        }

        return $children;
    }

    public static function computeDirHash(Folder $folder): string
    {
        return self::dir(self::folderChildren($folder));
    }

    /**
     * Пересчитать dir_hash папки и всех предков до корня. Вызывается
     * после любой мутации (создание/переименование/перенос/удаление).
     */
    public static function refreshFolderChain(?Folder $folder): void
    {
        while ($folder !== null) {
            $hash = self::computeDirHash($folder);
            if ($folder->dir_hash !== $hash) {
                $folder->dir_hash = $hash;
                $folder->saveQuietly();
            }
            $folder = $folder->parent;
        }
    }

    /**
     * dir_hash корня пользователя: корневые папки + файлы без папки.
     * Не хранится в БД — считается на лету (детей у корня немного).
     */
    public static function rootHash(User $user): string
    {
        $children = [];

        foreach ($user->folders()->whereNull('parent_id')->get() as $folder) {
            $children[] = [
                'name' => $folder->name,
                'hash' => self::folderEntry($folder->name, $folder->dirHash()),
            ];
        }
        foreach ($user->files()->whereNull('folder_id')->get() as $file) {
            $children[] = ['name' => $file->name, 'hash' => $file->entryHash()];
        }

        return self::dir($children);
    }

    /**
     * Полный пересчёт и сохранение dir_hash всех папок пользователя
     * (снизу вверх). Используется командой миграции и sync/tree.
     */
    public static function rebuildUserHashes(User $user): void
    {
        $folders = $user->folders()->get()->keyBy('id');
        $done = [];

        $compute = function (Folder $folder) use (&$compute, &$done, $folders): string {
            if (array_key_exists($folder->id, $done)) {
                return $done[$folder->id];
            }
            $children = [];
            foreach ($folders->where('parent_id', $folder->id) as $child) {
                $children[] = [
                    'name' => $child->name,
                    'hash' => self::folderEntry($child->name, $compute($child)),
                ];
            }
            foreach ($folder->files as $file) {
                $children[] = ['name' => $file->name, 'hash' => $file->entryHash()];
            }
            if ($folder->is_system) {
                $shots = Screenshot::where('user_id', $folder->user_id)->get();
                foreach ($shots as $shot) {
                    $children[] = ['name' => $shot->filename, 'hash' => $shot->entryHash()];
                }
            }
            $hash = self::dir($children);
            if ($folder->dir_hash !== $hash) {
                $folder->dir_hash = $hash;
                $folder->saveQuietly();
            }

            return $done[$folder->id] = $hash;
        };

        foreach ($folders as $folder) {
            $compute($folder);
        }
    }
}
