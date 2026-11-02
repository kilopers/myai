<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['torrent_id', 'selected_indexes', 'max_download_rate'])]
class TorrentSetting extends Model
{
    protected function casts(): array
    {
        return [
            'selected_indexes' => 'array',
            'max_download_rate' => 'integer',
        ];
    }

    /** @return BelongsTo<Torrent, $this> */
    public function torrent(): BelongsTo
    {
        return $this->belongsTo(Torrent::class);
    }
}
