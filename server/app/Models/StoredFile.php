<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Facades\Storage;

#[Fillable(['user_id', 'folder_id', 'uuid', 'name', 'filename', 'mime_type', 'size', 'path', 'expires_at'])]
class StoredFile extends Model
{
    protected $table = 'files';

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'size' => 'integer'];
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

    public function deleteFile(): void
    {
        Storage::disk('public')->delete($this->path);
    }
}
