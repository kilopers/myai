<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['board_column_id', 'title', 'text', 'position', 'number'])]
class BoardTask extends Model
{
    /**
     * @return BelongsTo<BoardColumn, $this>
     */
    public function column(): BelongsTo
    {
        return $this->belongsTo(BoardColumn::class, 'board_column_id');
    }

    /**
     * @return HasMany<BoardTaskAttachment, $this>
     */
    public function attachments(): HasMany
    {
        return $this->hasMany(BoardTaskAttachment::class)->orderBy('id');
    }

    /**
     * @return HasMany<BoardTaskComment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(BoardTaskComment::class)->orderBy('id');
    }
}
