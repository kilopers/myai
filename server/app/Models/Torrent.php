<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['user_id', 'folder_id', 'stored_file_id', 'result_folder_id', 'gid', 'info_hash', 'name', 'status', 'files', 'total_size', 'downloaded_size', 'progress', 'download_rate', 'error', 'log'])]
class Torrent extends Model
{
    /** Сколько последних строк держим в журнале загрузки. */
    private const LOG_CAP = 150;

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
            'log' => 'array',
        ];
    }

    /**
     * Строка в журнал загрузки (не сохраняет модель — вызывающий
     * сохраняет сам, обычно вместе с другими полями).
     */
    public function appendLog(string $message): void
    {
        $log = $this->log ?? [];
        $log[] = ['t' => now()->getTimestamp(), 'm' => $message];
        $this->log = array_slice($log, -self::LOG_CAP);
    }

    /** Unixtime последней строки журнала (0 — журнал пуст). */
    public function lastLogAt(): int
    {
        $log = $this->log ?? [];

        return (int) (end($log)['t'] ?? 0);
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

    /** Настройки загрузки (выбор файлов, лимит скорости) — torrent_settings. */
    public function settings(): HasOne
    {
        return $this->hasOne(TorrentSetting::class);
    }
}
