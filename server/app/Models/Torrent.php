<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'folder_id', 'stored_file_id', 'result_folder_id', 'gid', 'info_hash', 'name', 'status', 'files', 'total_size', 'downloaded_size', 'progress', 'download_rate', 'error'])]
class Torrent extends Model
{
    public const STATUS_AWAITING_SELECTION = 'awaiting_selection';

    public const STATUS_DOWNLOADING = 'downloading';

    public const STATUS_PAUSED = 'paused';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_ERROR = 'error';

    protected function casts(): array
    {
        return [
            'files' => 'array',
            'total_size' => 'integer',
            'downloaded_size' => 'integer',
            'progress' => 'integer',
            'download_rate' => 'integer',
        ];
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<Folder, $this> */
    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    /** @return BelongsTo<StoredFile, $this> */
    public function storedFile(): BelongsTo
    {
        return $this->belongsTo(StoredFile::class, 'stored_file_id');
    }

    /** @return BelongsTo<Folder, $this> */
    public function resultFolder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'result_folder_id');
    }
}
