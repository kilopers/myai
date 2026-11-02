<?php

namespace App\Http\Controllers;

use App\Models\PasswordEntry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
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
            'note' => ['nullable', 'string', 'max:5000'],
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
            'note' => ['nullable', 'string', 'max:5000'],
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
}
