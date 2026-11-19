<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'note_folder_id', 'title', 'text'])]
class Note extends Model
{
    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<NoteFolder, $this> */
    public function folder(): BelongsTo
    {
        return $this->belongsTo(NoteFolder::class, 'note_folder_id');
    }
}
