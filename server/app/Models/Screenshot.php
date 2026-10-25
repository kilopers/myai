<?php

namespace App\Models;

use App\Support\SyncHash;
use Database\Factories\ScreenshotFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

#[Fillable(['user_id', 'uuid', 'filename', 'mime_type', 'size', 'width', 'height', 'path', 'expires_at', 'original_path', 'mtime', 'entry_hash'])]
class Screenshot extends Model
{
    /** @use HasFactory<ScreenshotFactory> */
    use HasFactory, SoftDeletes;

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'mtime' => 'integer'];
    }

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function publicUrl(): string
    {
        $extension = pathinfo($this->path, PATHINFO_EXTENSION);

        return url("/i/{$this->uuid}.{$extension}");
    }

    /**
     * Хэш узла дерева синхронизации: имя узла — filename (uuid.ext),
     * ему же соответствует локальная копия в папке «Скриншоты».
     */
    public function entryHash(): string
    {
        return $this->entry_hash ?? SyncHash::file($this->filename, (int) $this->size, $this->mtime);
    }

    public function refreshEntryHash(): void
    {
        $this->entry_hash = SyncHash::file($this->filename, (int) $this->size, $this->mtime);
    }

    public function deleteFile(): void
    {
        Storage::disk('public')->delete($this->path);
    }
}
