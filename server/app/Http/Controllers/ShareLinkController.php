<?php

namespace App\Http\Controllers;

use App\Models\Folder;
use App\Models\ShareLink;
use App\Models\StoredFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShareLinkController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type' => ['required', 'in:file,folder'],
            'id' => ['required', 'integer'],
            'ttl_days' => ['nullable', 'integer', 'min:0', 'max:36500'],
            'can_write' => ['sometimes', 'boolean'],
        ]);

        $model = $validated['type'] === 'folder' ? Folder::class : StoredFile::class;
        $target = $model::where('user_id', $request->user()->id)
            ->findOrFail($validated['id']);

        $ttlDays = array_key_exists('ttl_days', $validated)
            ? $validated['ttl_days']
            : $request->user()->default_link_ttl_days;

        $link = ShareLink::create([
            'user_id' => $request->user()->id,
            'token' => ShareLink::newToken(),
            'linkable_type' => $model,
            'linkable_id' => $target->id,
            'expires_at' => $ttlDays ? now()->addDays((int) $ttlDays) : null,
            // «Разрешить загрузку» имеет смысл только для папок.
            'can_write' => ($validated['can_write'] ?? false) && $validated['type'] === 'folder',
        ]);

        return response()->json([
            'url' => $link->publicUrl(),
            'expires_at' => $link->expires_at?->toIso8601String(),
        ], 201);
    }

    public function destroy(Request $request, ShareLink $shareLink): JsonResponse
    {
        abort_unless($shareLink->user_id === $request->user()->id, 403);
        $shareLink->delete();

        return response()->json(['message' => 'Deleted.']);
    }
}
