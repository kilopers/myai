<?php

namespace App\Http\Controllers;

use App\Models\DeletedFile;
use App\Models\Folder;
use App\Support\SyncHash;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class SyncController extends Controller
{
    /**
     * Полное дерево пользователя для десктопной синхронизации:
     * папки с dir_hash, файлы/скриншоты с entry_hash и tombstones.
     * Скриншоты представлены файлами внутри системной папки «Скриншоты».
     */
    public function tree(Request $request): JsonResponse
    {
        $user = $request->user();

        // Папка «Скриншоты» нужна дереву всегда — скриншоты лежат в ней.
        $screenshotsFolder = Folder::screenshotsFolder($user);
        SyncHash::rebuildUserHashes($user);

        $folders = $user->folders()->get()->keyBy('id');
        $paths = [];
        $pathOf = function (Folder $folder) use (&$pathOf, $folders, &$paths): string {
            if (isset($paths[$folder->id])) {
                return $paths[$folder->id];
            }
            $parent = $folder->parent_id !== null ? $folders->get($folder->parent_id) : null;

            return $paths[$folder->id] = $parent !== null
                ? $pathOf($parent).'/'.$folder->name
                : $folder->name;
        };

        $folderRows = $folders->map(fn (Folder $f) => [
            'id' => $f->id,
            'parent_id' => $f->parent_id,
            'name' => $f->name,
            'is_system' => (bool) $f->is_system,
            'path' => $pathOf($f),
            'dir_hash' => $f->dirHash(),
            'entry_hash' => SyncHash::folderEntry($f->name, $f->dirHash()),
        ])->values();

        $entries = [];

        foreach ($user->files()->get() as $file) {
            $entries[] = [
                'id' => (string) $file->id,
                'kind' => 'file',
                'folder_id' => $file->folder_id,
                'name' => $file->name,
                'size' => (int) $file->size,
                'mtime' => $file->mtime ?? 0,
                'entry_hash' => $file->entryHash(),
                'download' => "api/files/{$file->id}/download",
            ];
        }
        foreach ($user->screenshots()->get() as $shot) {
            $entries[] = [
                'id' => $shot->uuid,
                'kind' => 'screenshot',
                'folder_id' => $screenshotsFolder->id,
                'name' => $shot->filename,
                'size' => (int) $shot->size,
                'mtime' => $shot->mtime ?? 0,
                'entry_hash' => $shot->entryHash(),
                'download' => 'i/'.$shot->uuid.'.'.pathinfo($shot->path, PATHINFO_EXTENSION),
            ];
        }

        return response()->json([
            'root_hash' => SyncHash::rootHash($user),
            'folders' => $folderRows,
            'entries' => $entries,
            'deleted' => $this->deletedRows($request),
        ]);
    }

    /**
     * Tombstone-лог: удалённые файлы/скриншоты (и папки) пользователя.
     * ?since=<date|unix> — только записи не старше метки.
     */
    public function deleted(Request $request): JsonResponse
    {
        return response()->json(['deleted' => $this->deletedRows($request)]);
    }

    /** @return array<int, array<string, mixed>> */
    private function deletedRows(Request $request): array
    {
        $query = DeletedFile::where('user_id', $request->user()->id)
            ->orderByDesc('deleted_at');

        if ($since = $request->query('since')) {
            $date = is_numeric($since)
                ? Carbon::createFromTimestamp((int) $since)
                : Carbon::parse($since);
            $query->where('deleted_at', '>=', $date);
        }

        return $query->limit(5000)->get()
            ->map(fn (DeletedFile $d) => [
                'kind' => $d->kind,
                'name' => $d->name,
                'size' => (int) $d->size,
                'mtime' => $d->mtime,
                'entry_hash' => $d->entry_hash,
                'dir_path' => $d->dir_path,
                'deleted_at' => $d->deleted_at->toIso8601String(),
            ])->values()->all();
    }
}
