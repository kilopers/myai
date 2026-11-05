<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'password_folder_id', 'name', 'login', 'password', 'url', 'note', 'expires_at', 'share_token', 'share_expires_at'])]
class PasswordEntry extends Model
{
    protected function casts(): array
    {
        return [
            // Пароль лежит в БД зашифрованным ключом приложения.
            'password' => 'encrypted',
            'expires_at' => 'datetime',
            'share_expires_at' => 'datetime',
        ];
    }

    /** Активная (не истекшая) гостевая ссылка на карточку записи. */
    public function shareLinkActive(): bool
    {
        return $this->share_token !== null
            && $this->share_expires_at !== null
            && $this->share_expires_at->isFuture();
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<PasswordFolder, $this> */
    public function folder(): BelongsTo
    {
        return $this->belongsTo(PasswordFolder::class, 'password_folder_id');
    }
}
