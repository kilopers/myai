<?php

use App\Models\DeletedFile;
use App\Models\Folder;
use App\Models\StoredFile;
use App\Support\SyncHash;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    /**
     * Системная папка «Скриншоты» больше не создаётся автоматически:
     * скриншоты лежат в корне дерева синхронизации. Существующие
     * системные папки удаляются — их содержимое уезжает на верхний
     * уровень, в deleted_files пишется tombstone для десктопа.
     */
    public function up(): void
    {
        Folder::withTrashed()->where('is_system', true)->get()->each(function (Folder $folder) {
            Folder::withTrashed()->where('parent_id', $folder->id)->update(['parent_id' => null]);
            StoredFile::withTrashed()->where('folder_id', $folder->id)->update(['folder_id' => null]);

            DeletedFile::create([
                'user_id' => $folder->user_id,
                'kind' => 'folder',
                'name' => $folder->name,
                'size' => 0,
                'mtime' => null,
                'entry_hash' => SyncHash::folderEntry($folder->name, $folder->dirHash()),
                'dir_path' => '',
                'deleted_at' => now(),
            ]);

            $folder->forceDelete();
        });
    }

    public function down(): void
    {
        // Системные папки обратно не восстанавливаем.
    }
};
