<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['board_task_id', 'user_id', 'text'])]
class BoardTaskComment extends Model
{
    /**
     * @return BelongsTo<BoardTask, $this>
     */
    public function task(): BelongsTo
    {
        return $this->belongsTo(BoardTask::class, 'board_task_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<BoardTaskAttachment, $this>
     */
    public function attachments(): HasMany
    {
        return $this->hasMany(BoardTaskAttachment::class, 'board_task_comment_id')->orderBy('id');
    }
}
