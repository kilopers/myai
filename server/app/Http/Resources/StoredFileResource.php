<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StoredFileResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'uuid' => $this->uuid,
            'name' => $this->name,
            'mime_type' => $this->mime_type,
            'size' => $this->size,
            'folder_id' => $this->folder_id,
            'expires_at' => $this->expires_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            // Статус фоновой конвертации (none|pending|processing|done|failed).
            'conversion_status' => $this->conversion_status,
            'conversion_progress' => (int) $this->conversion_progress,
            'pages_total' => $this->pages_total,
            'pages_done' => $this->pages_done,
            'has_derivatives' => (bool) ($this->derivatives_count ?? $this->derivatives()->exists()),
            'links' => $this->whenLoaded('shareLinks', fn () => $this->shareLinks->map(fn ($l) => [
                'id' => $l->id,
                'url' => $l->publicUrl(),
                'expires_at' => $l->expires_at?->toIso8601String(),
            ])),
        ];
    }
}
