<?php

namespace App\Http\Controllers;

use App\Models\PasswordEntry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class PasswordEntryController extends Controller
{
    /**
     * Без password_folder_id — весь справочник; q ищет по названию,
     * логину, описанию и имени папки (поиск по всему справочнику).
     * Выдача постраничная по 20 записей.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $validated = $request->validate([
            'password_folder_id' => ['nullable', 'integer'],
            'q' => ['nullable', 'string', 'max:200'],
        ]);

        $entries = $request->user()->passwordEntries()
            ->with('folder:id,name')
            ->when($validated['password_folder_id'] ?? null,
                fn ($query, $folderId) => $query->where('password_folder_id', $folderId))
            ->when($validated['q'] ?? null, function ($query, $term) {
                $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $term).'%';
                $query->where(fn ($q) => $q
                    ->where('name', 'like', $like)
                    ->orWhere('login', 'like', $like)
                    ->orWhere('note', 'like', $like)
                    ->orWhereHas('folder', fn ($f) => $f->where('name', 'like', $like)));
            })
            ->orderBy('name')
            ->paginate(20);

        return JsonResource::collection($entries);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'password_folder_id' => [
                'required',
                'integer',
                Rule::exists('password_folders', 'id')->where('user_id', $request->user()->id),
            ],
            'name' => ['required', 'string', 'max:200'],
            'login' => ['nullable', 'string', 'max:300'],
            'password' => ['required', 'string', 'max:2000'],
            'url' => ['nullable', 'string', 'max:2048'],
            'note' => ['nullable', 'string', 'max:5000'],
            'expires_at' => ['nullable', 'date'],
        ]);

        $entry = $request->user()->passwordEntries()->create($validated);

        return (new JsonResource($entry))->response()->setStatusCode(201);
    }

    public function update(Request $request, PasswordEntry $passwordEntry): JsonResource
    {
        abort_unless($passwordEntry->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'password_folder_id' => [
                'sometimes',
                'integer',
                Rule::exists('password_folders', 'id')->where('user_id', $request->user()->id),
            ],
            'name' => ['sometimes', 'string', 'max:200'],
            'login' => ['nullable', 'string', 'max:300'],
            'password' => ['sometimes', 'string', 'max:2000'],
            'url' => ['nullable', 'string', 'max:2048'],
            'note' => ['nullable', 'string', 'max:5000'],
            'expires_at' => ['nullable', 'date'],
        ]);

        $passwordEntry->update($validated);

        return new JsonResource($passwordEntry);
    }

    public function destroy(Request $request, PasswordEntry $passwordEntry): JsonResponse
    {
        abort_unless($passwordEntry->user_id === $request->user()->id, 403);

        $passwordEntry->delete();

        return response()->json(['message' => 'Deleted.']);
    }

    /**
     * Создать/пересоздать временную гостевую ссылку на карточку записи.
     * Срок жизни обязателен (минуты, максимум 30 дней): «бесконечной»
     * ссылки на пароль не бывает. Повторный вызов генерирует новый токен —
     * старый URL сразу перестаёт работать.
     */
    public function shareLink(Request $request, PasswordEntry $passwordEntry): JsonResponse
    {
        abort_unless($passwordEntry->user_id === $request->user()->id, 403);

        $validated = $request->validate([
            'ttl_minutes' => ['required', 'integer', 'min:1', 'max:43200'],
        ]);

        $passwordEntry->update([
            'share_token' => Str::random(48),
            'share_expires_at' => now()->addMinutes((int) $validated['ttl_minutes']),
        ]);

        return response()->json([
            'url' => "/p/{$passwordEntry->share_token}",
            'expires_at' => $passwordEntry->share_expires_at->toIso8601String(),
        ], 201);
    }

    /** Отзыв гостевой ссылки — публичный URL перестаёт работать. */
    public function revokeShareLink(Request $request, PasswordEntry $passwordEntry): JsonResponse
    {
        abort_unless($passwordEntry->user_id === $request->user()->id, 403);

        $passwordEntry->update(['share_token' => null, 'share_expires_at' => null]);

        return response()->json(['message' => 'Revoked.']);
    }
}
