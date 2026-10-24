<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

#[Fillable(['user_id', 'parent_id', 'name', 'default_ttl_days'])]
class Folder extends Model
{
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
}
