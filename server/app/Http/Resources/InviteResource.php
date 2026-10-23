<?php

namespace App\Http\Resources;

use App\Models\Invite;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Invite
 */
class InviteResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'token' => $this->token,
            'url' => url("/invite/{$this->token}"),
            'status' => $this->used_at !== null ? 'used' : ($this->expires_at->isPast() ? 'expired' : 'active'),
            'created_by' => $this->whenLoaded('creator', fn () => $this->creator->name),
            'used_by' => $this->whenLoaded('invitedUser', fn () => $this->invitedUser?->email),
            'expires_at' => $this->expires_at->toIso8601String(),
            'used_at' => $this->used_at?->toIso8601String(),
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
