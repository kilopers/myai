<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin User
 */
class UserResource extends JsonResource
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
            'name' => $this->name,
            'email' => $this->email,
            'is_admin' => $this->is_admin,
            'default_screenshot_ttl_days' => $this->default_screenshot_ttl_days,
            'default_file_ttl_days' => $this->default_file_ttl_days,
            'default_link_ttl_days' => $this->default_link_ttl_days,
            'screenshots_count' => $this->whenCounted('screenshots'),
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
