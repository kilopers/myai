<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password', 'is_admin', 'must_change_password', 'default_screenshot_ttl_days', 'default_file_ttl_days', 'default_link_ttl_days', 'trash_retention_days'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
            'must_change_password' => 'boolean',
        ];
    }

    /**
     * @return HasMany<Screenshot, $this>
     */
    public function screenshots(): HasMany
    {
        return $this->hasMany(Screenshot::class);
    }

    /**
     * @return HasMany<StoredFile, $this>
     */
    public function files(): HasMany
    {
        return $this->hasMany(StoredFile::class);
    }

    /**
     * @return HasMany<Folder, $this>
     */
    public function folders(): HasMany
    {
        return $this->hasMany(Folder::class);
    }

    /**
     * @return HasMany<PasswordFolder, $this>
     */
    public function passwordFolders(): HasMany
    {
        return $this->hasMany(PasswordFolder::class);
    }

    /**
     * @return HasMany<PasswordEntry, $this>
     */
    public function passwordEntries(): HasMany
    {
        return $this->hasMany(PasswordEntry::class);
    }

    /**
     * @return HasMany<PasswordGenerator, $this>
     */
    public function passwordGenerators(): HasMany
    {
        return $this->hasMany(PasswordGenerator::class);
    }

    /**
     * @return HasMany<Board, $this>
     */
    public function boards(): HasMany
    {
        return $this->hasMany(Board::class);
    }

    /**
     * @return HasMany<Invite, $this>
     */
    public function invites(): HasMany
    {
        return $this->hasMany(Invite::class, 'created_by');
    }
}
