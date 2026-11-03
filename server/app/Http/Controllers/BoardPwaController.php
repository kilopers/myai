<?php

namespace App\Http\Controllers;

use App\Models\Board;
use App\Services\BoardIcon;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * PWA-эндпоинты доски — публичные, доступ по токену:
 *  - share_token    → «приложение» гостя: start_url /b/{token}
 *  - manifest_token → «приложение» владельца: start_url /boards/{id}
 *
 * Манифест и иконки скачивает браузер без Bearer-заголовков,
 * поэтому защита — неугадываемость токена (как у /f/ и /i/ роутов).
 */
class BoardPwaController extends Controller
{
    private function board(string $token): ?Board
    {
        return Board::where('share_token', $token)
            ->orWhere('manifest_token', $token)
            ->first();
    }

    private function isGuest(Board $board, string $token): bool
    {
        return hash_equals((string) $board->share_token, $token);
    }

    /** Динамический manifest.webmanifest — у каждой доски свой. */
    public function manifest(string $token): JsonResponse
    {
        $board = $this->board($token);
        abort_unless($board, 404);

        $guest = $this->isGuest($board, $token);
        $startUrl = $guest ? "/b/{$token}" : "/boards/{$board->id}";
        $icons = [];
        foreach (BoardIcon::FILES as $file => $cfg) {
            $icons[] = [
                'src' => "/api/board-apps/{$token}/icons/{$file}",
                'sizes' => "{$cfg['size']}x{$cfg['size']}",
                'type' => 'image/png',
                'purpose' => $cfg['maskable'] ? 'maskable' : 'any',
            ];
        }

        return response()->json([
            'name' => $board->name,
            'short_name' => mb_strimwidth($board->name, 0, 30, ''),
            'start_url' => $startUrl,
            'scope' => $startUrl,
            'display' => 'standalone',
            'orientation' => 'portrait',
            'theme_color' => '#171321',
            'background_color' => '#fbfafd',
            'icons' => $icons,
        ], 200, ['Content-Type' => 'application/manifest+json']);
    }

    /** PNG-иконка доски; при отсутствии файлов генерирует на лету. */
    public function icon(string $token, string $file, BoardIcon $icons): StreamedResponse
    {
        abort_unless(array_key_exists($file, BoardIcon::FILES), 404);

        $board = $this->board($token);
        abort_unless($board, 404);

        $path = BoardIcon::dir($board)."/{$file}";
        if (! Storage::disk('public')->exists($path)) {
            $icons->generate($board);
            abort_unless(Storage::disk('public')->exists($path), 404);
        }

        return Storage::disk('public')->response($path, $file, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'public, max-age=3600',
        ], 'inline');
    }
}
