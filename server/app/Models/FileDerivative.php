<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * Производный файл фоновой конвертации (миниатюра, страница, mp4, pdf,
 * poster). В десктопную синхронизацию не входит: записи живут в своей
 * таблице и не участвуют в entry_hash/dir_hash/root_hash и tombstone'ах.
 * Soft-delete оригинала производные сохраняет (для restore), физическое
 * удаление — в TrashService::purgeFile + FK cascade.
 */
#[Fillable(['file_id', 'kind', 'page_number', 'path', 'mime_type', 'size', 'width', 'height'])]
class FileDerivative extends Model
{
    public const KIND_THUMBNAIL = 'thumbnail';

    public const KIND_PAGE = 'page';

    public const KIND_VIDEO = 'video';

    public const KIND_PDF = 'pdf';

    public const KIND_POSTER = 'poster';

    protected $table = 'file_derivatives';

    protected function casts(): array
    {
        return [
            'page_number' => 'integer',
            'size' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
        ];
    }

    /** @return BelongsTo<StoredFile, $this> */
    public function file(): BelongsTo
    {
        return $this->belongsTo(StoredFile::class, 'file_id');
    }

    public function deleteFile(): void
    {
        Storage::disk('public')->delete($this->path);
    }
}
