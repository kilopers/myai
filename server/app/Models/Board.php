<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['user_id', 'name', 'prefix', 'next_task_number', 'share_token', 'guest_permissions'])]
class Board extends Model
{
    protected function casts(): array
    {
        return ['guest_permissions' => 'array'];
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
}
