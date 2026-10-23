<?php

namespace App\Models;

use Database\Factories\ScreenshotFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

#[Fillable(['user_id', 'uuid', 'filename', 'mime_type', 'size', 'width', 'height', 'path'])]
class Screenshot extends Model
{
    /** @use HasFactory<ScreenshotFactory> */
    use HasFactory;

    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function publicUrl(): string
    {
        $extension = pathinfo($this->path, PATHINFO_EXTENSION);

        return url("/i/{$this->uuid}.{$extension}");
    }

    public function deleteFile(): void
    {
        Storage::disk('public')->delete($this->path);
    }
}
