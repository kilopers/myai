<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

#[Fillable(['board_task_id', 'user_id', 'uuid', 'kind', 'name', 'filename', 'mime_type', 'size', 'path'])]
class BoardTaskAttachment extends Model
{
    /**
     * @return BelongsTo<BoardTask, $this>
     */
    public function task(): BelongsTo
    {
        return $this->belongsTo(BoardTask::class, 'board_task_id');
    }

    public function isPhoto(): bool
    {
        return $this->kind === 'photo';
    }

    /** Удаляет запись и физический файл с public-диска. */
    public function deleteFile(): void
    {
        $path = $this->path;
        $this->delete();
        Storage::disk('public')->delete($path);
    }
}
