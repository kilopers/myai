<?php

namespace App\Http\Resources;

use App\Models\Screenshot;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Screenshot
 */
class ScreenshotResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'url' => $this->publicUrl(),
            'mime_type' => $this->mime_type,
            'size' => $this->size,
            'width' => $this->width,
            'height' => $this->height,
            'created_at' => $this->created_at->toIso8601String(),
            'expires_at' => $this->expires_at?->toIso8601String(),
        ];
    }
}
