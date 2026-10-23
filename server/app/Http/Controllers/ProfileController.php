<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ProfileController extends Controller
{
    /**
     * Update own profile: name, email, default retention settings.
     */
    public function update(Request $request): UserResource
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'email', 'max:255', Rule::unique('users')->ignore($request->user()->id)],
            'default_screenshot_ttl_days' => ['nullable', 'integer', 'min:0', 'max:36500'],
            'default_file_ttl_days' => ['nullable', 'integer', 'min:0', 'max:36500'],
            'default_link_ttl_days' => ['nullable', 'integer', 'min:0', 'max:36500'],
        ]);

        $request->user()->update($validated);

        return new UserResource($request->user());
    }
}
