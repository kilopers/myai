<?php

namespace App\Models;

use App\Support\SyncHash;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

#[Fillable(['user_id', 'folder_id', 'uuid', 'name', 'filename', 'mime_type', 'size', 'path', 'expires_at', 'original_path', 'mtime', 'entry_hash'])]
class StoredFile extends Model
{
    use SoftDeletes;

    protected $table = 'files';

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'size' => 'integer', 'mtime' => 'integer'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<Folder, $this> */
    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    /** @return MorphMany<ShareLink, $this> */
    public function shareLinks(): MorphMany
    {
        return $this->morphMany(ShareLink::class, 'linkable');
    }

    /**
     * Хэш узла дерева синхронизации: sha256(name|size|mtime).
     * Хранится в колонке; для старых записей считается на лету.
     */
    public function entryHash(): string
    {
        return $this->entry_hash ?? SyncHash::file($this->name, (int) $this->size, $this->mtime);
    }

    public function refreshEntryHash(): void
    {
        $this->entry_hash = SyncHash::file($this->name, (int) $this->size, $this->mtime);
    }

    public function deleteFile(): void
    {
        Storage::disk('public')->delete($this->path);
    }
}
