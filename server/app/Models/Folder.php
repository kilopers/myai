<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable(['user_id', 'parent_id', 'name', 'default_ttl_days', 'conversion_enabled', 'torrent_mode'])]
class Folder extends Model
{
    use SoftDeletes;

    /** Системная корневая папка скриншотов — создаётся автоматически, не удаляется. */
    public const SCREENSHOTS_DIR = 'Скриншоты';

    protected function casts(): array
    {
        return ['is_system' => 'boolean', 'conversion_enabled' => 'boolean'];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<Folder, $this> */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'parent_id');
    }

    /** @return HasMany<Folder, $this> */
    public function children(): HasMany
    {
        return $this->hasMany(Folder::class, 'parent_id');
    }

    /** @return HasMany<StoredFile, $this> */
    public function files(): HasMany
    {
        return $this->hasMany(StoredFile::class);
    }

    /** @return MorphMany<ShareLink, $this> */
    public function shareLinks(): MorphMany
    {
        return $this->morphMany(ShareLink::class, 'linkable');
    }

    /**
     * dir_hash существующей папки; у пустых/непересчитанных — sha256('').
     */
    public function dirHash(): string
    {
        return $this->dir_hash ?? hash('sha256', '');
    }
}
