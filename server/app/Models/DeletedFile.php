<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Tombstone-запись: лог удалённых файлов/скриншотов. Нужна десктопной
 * синхронизации, чтобы отличать «удалено на сервере» от «новый
 * локальный файл» по entry_hash. Хранится 6 месяцев (uploads:prune).
 */
#[Fillable(['user_id', 'kind', 'name', 'size', 'mtime', 'entry_hash', 'dir_path', 'deleted_at'])]
class DeletedFile extends Model
{
    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'mtime' => 'integer',
            'deleted_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
