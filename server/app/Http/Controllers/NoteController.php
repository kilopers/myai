<?php

namespace App\Http\Controllers;

use App\Models\Note;
use App\Models\NoteFolder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;

class NoteController extends Controller
{
    /**
     * Без note_folder_id — все заметки; q ищет по заголовку и тексту.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $validated = $request->validate([
            'note_folder_id' => ['nullable', 'integer'],
            'q' => ['nullable', 'string', 'max:200'],
        ]);

        $notes = $request->user()->notes()
            ->with('folder:id,name')
            ->when($validated['note_folder_id'] ?? null,
                fn ($query, $folderId) => $query->where('note_folder_id', $folderId))
            ->when($validated['q'] ?? null, function ($query, $term) {
                $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $term).'%';
                $query->where(fn ($q) => $q
                    ->where('title', 'like', $like)
                    ->orWhere('text', 'like', $like));
            })
            ->latest('updated_at')
            ->get();

        return JsonResource::collection($notes);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $this->validateData($request, creating: true);

        if (isset($validated['note_folder_id'])) {
            abort_unless(
                NoteFolder::where('id', $validated['note_folder_id'])
                    ->where('user_id', $request->user()->id)->exists(),
                422,
            );
        }

        $note = $request->user()->notes()->create($validated);

        return (new JsonResource($note->load('folder:id,name')))->response()->setStatusCode(201);
    }

    public function update(Request $request, Note $note): JsonResource
    {
        abort_unless($note->user_id === $request->user()->id, 403);

        $validated = $this->validateData($request);

        if (isset($validated['note_folder_id'])) {
            abort_unless(
                NoteFolder::where('id', $validated['note_folder_id'])
                    ->where('user_id', $request->user()->id)->exists(),
                422,
            );
        }

        $note->update($validated);

        return new JsonResource($note->load('folder:id,name'));
    }

    public function destroy(Request $request, Note $note): JsonResponse
    {
        abort_unless($note->user_id === $request->user()->id, 403);

        $note->delete();

        return response()->json(['message' => 'Deleted.']);
    }

    /** @return array<string, mixed> */
    private function validateData(Request $request, bool $creating = false): array
    {
        return $request->validate([
            'note_folder_id' => ['nullable', 'integer'],
            'title' => [$creating ? 'required' : 'sometimes', 'required', 'string', 'max:200'],
            'text' => ['nullable', 'string'],
        ]);
    }
}
