<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['board_id', 'name', 'color', 'position', 'visible_guests'])]
class BoardColumn extends Model
{
    protected function casts(): array
    {
        return ['visible_guests' => 'boolean'];
    }

    /**
     * @return BelongsTo<Board, $this>
     */
    public function board(): BelongsTo
    {
        return $this->belongsTo(Board::class);
    }

    /**
     * @return HasMany<BoardTask, $this>
     */
    public function tasks(): HasMany
    {
        return $this->hasMany(BoardTask::class)->orderBy('position');
    }
}
