<?php

namespace App\Models;

use App\Support\StoragePath;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

#[Fillable(['board_task_id', 'board_task_comment_id', 'user_id', 'uuid', 'kind', 'name', 'filename', 'mime_type', 'size', 'path'])]
class BoardTaskAttachment extends Model
{
    /**
     * @return BelongsTo<BoardTask, $this>
     */
    public function task(): BelongsTo
    {
        return $this->belongsTo(BoardTask::class, 'board_task_id');
    }

    /**
     * Сохраняет загруженный файл на public-диск (attachments/{ab}/{cd}/uuid.ext)
     * и возвращает несохранённую запись — привязку (task/comment) ставит вызывающий.
     */
    public static function fromUpload(UploadedFile $uploaded, int $userId): self
    {
        $mime = $uploaded->getMimeType();
        $extension = strtolower($uploaded->getClientOriginalExtension() ?: 'bin');
        $uuid = (string) Str::uuid();
        $path = StoragePath::attachment($uuid, $extension);
        Storage::disk('public')->putFileAs(dirname($path), $uploaded, basename($path));

        return new self([
            'user_id' => $userId,
            'uuid' => $uuid,
            'kind' => str_starts_with((string) $mime, 'image/') ? 'photo' : 'file',
            'name' => $uploaded->getClientOriginalName() ?: "file.{$extension}",
            'filename' => "{$uuid}.{$extension}",
            'mime_type' => $mime,
            'size' => $uploaded->getSize() ?: 0,
            'path' => $path,
        ]);
    }

    public function isPhoto(): bool
    {
        return $this->kind === 'photo';
    }

    /** Удаляет запись и физический файл с public-диска. */
    public function deleteFile(): void
    {
        $path = $this->path;
        $this->delete();
        Storage::disk('public')->delete($path);
    }
}
