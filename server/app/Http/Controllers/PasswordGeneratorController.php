<?php

namespace App\Http\Controllers;

use App\Models\PasswordGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\ValidationException;

class PasswordGeneratorController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $generators = $request->user()->passwordGenerators()
            ->orderBy('name')
            ->get();

        return JsonResource::collection($generators);
    }

    public function store(Request $request): JsonResponse
    {
        $generator = $request->user()->passwordGenerators()
            ->create($this->validated($request));

        return (new JsonResource($generator))->response()->setStatusCode(201);
    }

    public function update(Request $request, PasswordGenerator $passwordGenerator): JsonResource
    {
        abort_unless($passwordGenerator->user_id === $request->user()->id, 403);

        $passwordGenerator->update($this->validated($request));

        return new JsonResource($passwordGenerator);
    }

    public function destroy(Request $request, PasswordGenerator $passwordGenerator): JsonResponse
    {
        abort_unless($passwordGenerator->user_id === $request->user()->id, 403);

        $passwordGenerator->delete();

        return response()->json(['message' => 'Deleted.']);
    }

    /**
     * Пакетная генерация для вкладки «Случайные пароли»:
     * по count паролей на каждый алгоритм пользователя одним запросом.
     */
    public function generateBatch(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'count' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $count = $validated['count'] ?? 15;

        $batches = $request->user()->passwordGenerators()
            ->orderBy('name')
            ->get()
            ->mapWithKeys(fn (PasswordGenerator $g) => [
                $g->id => collect(range(1, $count))->map(fn () => $g->generate())->all(),
            ]);

        return response()->json(['passwords' => $batches]);
    }

    /**
     * Выдать свежий пароль по алгоритму — фронт кладёт его в поле
     * формы и сразу копирует в буфер обмена.
     */
    public function generate(Request $request, PasswordGenerator $passwordGenerator): JsonResponse
    {
        abort_unless($passwordGenerator->user_id === $request->user()->id, 403);

        return response()->json(['password' => $passwordGenerator->generate()]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request): array
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'min_length' => ['required', 'integer', 'min:4', 'max:512'],
            'max_length' => ['required', 'integer', 'gte:min_length', 'max:512'],
            'use_lower' => ['boolean'],
            'use_upper' => ['boolean'],
            'use_digits' => ['boolean'],
            'use_symbols' => ['boolean'],
            'symbols' => ['nullable', 'string', 'max:100'],
        ]);

        if (! ($validated['use_lower'] ?? false)
            && ! ($validated['use_upper'] ?? false)
            && ! ($validated['use_digits'] ?? false)
            && ! ($validated['use_symbols'] ?? false)) {
            throw ValidationException::withMessages([
                'use' => 'Выберите хотя бы один набор символов.',
            ]);
        }

        return $validated;
    }
}
