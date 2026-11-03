<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

#[Fillable(['user_id', 'name', 'prefix', 'next_task_number', 'share_token', 'guest_permissions', 'icon', 'manifest_token'])]
class Board extends Model
{
    protected $appends = ['icon_url'];

    protected static function booted(): void
    {
        // Токен публичного PWA-манифеста владельца — по аналогии с share_token,
        // но выдаётся сразу: «приложение доски» может не иметь гостевой ссылки.
        static::creating(fn (Board $board) => $board->manifest_token ??= Str::random(48));
    }

    protected function casts(): array
    {
        return ['guest_permissions' => 'array'];
    }

    /** Иконка доски для списков/PWA (по manifest_token — публичный роут).
     *  ?v= — cache-busting: URL меняется при обновлении доски, иначе
     *  браузер/PWA-установка держит устаревшую иконку. */
    protected function iconUrl(): Attribute
    {
        return Attribute::get(fn () => "/api/board-apps/{$this->manifest_token}/icons/icon-192.png?v={$this->updated_at?->timestamp}");
    }

    /** Возможности гостя по share-ссылке; пустое значение — всё разрешено. */
    public function guestCan(string $cap): bool
    {
        return (bool) (($this->guest_permissions ?? [])[$cap] ?? true);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<BoardColumn, $this>
     */
    public function columns(): HasMany
    {
        return $this->hasMany(BoardColumn::class)->orderBy('position');
    }

    /**
     * @return HasMany<PushSubscription, $this>
     */
    public function pushSubscriptions(): HasMany
    {
        return $this->hasMany(PushSubscription::class);
    }
}
