<?php

namespace App\Http\Controllers;

use App\Models\FileDerivative;
use App\Models\Folder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Process;

class StorageController extends Controller
{
    /**
     * Сводка по хранилищу из БД: файлы/производные/скриншоты/корзина
     * + занятое место на диске (быстрый disk_total/disk_free).
     */
    public function summary(Request $request): JsonResponse
    {
        $user = $request->user();
        $root = (string) config('filesystems.disks.public.root');
        $diskTotal = (int) @disk_total_space($root);
        $diskFree = (int) @disk_free_space($root);

        $derivatives = FileDerivative::query()
            ->whereHas('file', fn ($q) => $q->where('user_id', $user->id)->withTrashed());

        // Корзина — только реально лежащие в ней soft-deleted записи.
        // deleted_files НЕ считаем: это tombstone-журнал десктоп-синка,
        // он переживает очистку корзины и двоил бы цифры.
        $trashCount = $user->files()->onlyTrashed()->count()
            + $user->screenshots()->onlyTrashed()->count();
        $trashSize = (int) $user->files()->onlyTrashed()->sum('size')
            + (int) $user->screenshots()->onlyTrashed()->sum('size');

        return response()->json([
            'files' => [
                'count' => $user->files()->count(),
                'size' => (int) $user->files()->sum('size'),
            ],
            'derivatives' => [
                'count' => (clone $derivatives)->count(),
                'size' => (int) (clone $derivatives)->sum('size'),
            ],
            'screenshots' => [
                'count' => $user->screenshots()->count(),
                'size' => (int) $user->screenshots()->sum('size'),
            ],
            'trash' => [
                'count' => $trashCount,
                'size' => $trashSize,
            ],
            // Кэш размеров папок из БД (сумма files.size внутри папок).
            'folders_size' => (int) Folder::where('user_id', $user->id)->sum('size'),
            'disk' => [
                'total' => $diskTotal,
                'free' => $diskFree,
                'used' => max(0, $diskTotal - $diskFree),
            ],
        ]);
    }

    /**
     * Реальный размер каталогов хранилища на диске (du -sb) —
     * медленно на больших деревьях, фронт дёргает отдельно.
     */
    public function realSize(Request $request): JsonResponse
    {
        $paths = [
            'files' => (string) config('filesystems.disks.public.root'),
            'torrents' => (string) config('filesystems.disks.torrents.root'),
        ];

        $sizes = [];
        $total = 0;
        foreach ($paths as $key => $path) {
            $size = $this->dirSize($path);
            $sizes[$key] = $size;
            $total += $size;
        }

        return response()->json(['paths' => $sizes, 'total' => $total]);
    }

    private function dirSize(string $path): int
    {
        if (! is_dir($path)) {
            return 0;
        }
        // du -sb на больших деревьях на порядки быстрее PHP-рекурсии.
        try {
            $result = Process::timeout(120)->run('du -sb '.escapeshellarg($path));
            if ($result->successful() && preg_match('/^(\d+)/', $result->output(), $m)) {
                return (int) $m[1];
            }
        } catch (\Throwable) {
            // du недоступен — fallback на итератор ниже.
        }

        $size = 0;
        foreach (new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS)
        ) as $f) {
            $size += $f->getSize();
        }

        return $size;
    }
}
