<?php

namespace App\Http\Controllers;

use App\Models\Torrent;
use App\Services\Torrent\TorrentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TorrentController extends Controller
{
    /**
     * Полное состояние торрента, включая список файлов для модалки
     * выбора (карточка в списке получает сокращённый payload через
     * StoredFileResource).
     */
    public function show(Request $request, Torrent $torrent): JsonResponse
    {
        $this->authorize($request, $torrent);

        return response()->json($this->toArray($torrent));
    }

    /**
     * Старт загрузки: {file_indexes: int[]} — 0-based индексы файлов;
     * пустой массив или отсутствие параметра — качать все.
     */
    public function start(Request $request, Torrent $torrent, TorrentService $service): JsonResponse
    {
        $this->authorize($request, $torrent);
        $validated = $request->validate([
            'file_indexes' => ['nullable', 'array'],
            'file_indexes.*' => ['integer', 'min:0'],
        ]);

        try {
            $service->start($torrent, $validated['file_indexes'] ?? null);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json($this->toArray($torrent->refresh()));
    }

    public function pause(Request $request, Torrent $torrent, TorrentService $service): JsonResponse
    {
        $this->authorize($request, $torrent);
        $service->pause($torrent);

        return response()->json($this->toArray($torrent->refresh()));
    }

    public function resume(Request $request, Torrent $torrent, TorrentService $service): JsonResponse
    {
        $this->authorize($request, $torrent);
        $service->resume($torrent);

        return response()->json($this->toArray($torrent->refresh()));
    }

    /**
     * Удаление: ?with_data=1 — вместе с result-папкой, её содержимым
     * и самим .torrent-файлом (всё уходит в корзину); по умолчанию —
     * только запись задачи, скачанные данные остаются.
     */
    public function destroy(Request $request, Torrent $torrent, TorrentService $service): JsonResponse
    {
        $this->authorize($request, $torrent);
        $service->destroy($torrent, $request->boolean('with_data'));

        return response()->json(['message' => 'Torrent deleted.']);
    }

    private function authorize(Request $request, Torrent $torrent): void
    {
        abort_unless($torrent->user_id === $request->user()->id, 403);
    }

    /** @return array<string, mixed> */
    private function toArray(Torrent $torrent): array
    {
        return [
            'id' => $torrent->id,
            'stored_file_id' => $torrent->stored_file_id,
            'folder_id' => $torrent->folder_id,
            'result_folder_id' => $torrent->result_folder_id,
            'info_hash' => $torrent->info_hash,
            'name' => $torrent->name,
            'status' => $torrent->status,
            'files' => $torrent->files ?? [],
            'total_size' => $torrent->total_size,
            'downloaded_size' => $torrent->downloaded_size,
            'progress' => $torrent->progress,
            'download_rate' => $torrent->download_rate,
            'error' => $torrent->error,
            'created_at' => $torrent->created_at?->toIso8601String(),
        ];
    }
}
