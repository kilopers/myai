<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Str;

#[Fillable(['user_id', 'token', 'linkable_type', 'linkable_id', 'expires_at', 'can_write'])]
class ShareLink extends Model
{
    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'can_write' => 'boolean'];
    }

    public static function newToken(): string
    {
        return Str::random(48);
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    /**
     * Скоуп «живых» ссылок — для бейджа «есть активная ссылка» у папки.
     *
     * @param  Builder<ShareLink>  $query
     */
    public function scopeActive(Builder $query): void
    {
        $query->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()));
    }

    public function publicUrl(): string
    {
        $prefix = $this->linkable_type === Folder::class ? '/d/' : '/f/';

        return url($prefix.$this->token);
    }

    /** @return MorphTo<Model, $this> */
    public function linkable(): MorphTo
    {
        return $this->morphTo();
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
