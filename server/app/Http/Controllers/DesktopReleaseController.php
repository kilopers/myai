<?php

namespace App\Http\Controllers;

use App\Jobs\DesktopReleaseSyncJob;
use App\Services\DesktopReleaseSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class DesktopReleaseController extends Controller
{
    /**
     * Публичный endpoint актуальной версии десктопа: клиент дергает его
     * при подключении (страховка на случай пропущенного WS-push).
     */
    public function version(DesktopReleaseSync $sync): JsonResponse
    {
        $manifest = $sync->manifest();
        $version = $manifest['version'] ?? $sync->appVersion();
        $downloads = $sync->downloads($manifest);

        return response()->json([
            'version' => $version,
            'downloads' => $downloads !== [] ? $downloads : null,
            'notes_url' => $manifest['notes_url']
                ?? 'https://github.com/'.DesktopReleaseSync::REPO."/releases/tag/v{$version}",
        ]);
    }

    /**
     * Раздача инсталлятора с нашего сервера (прямые public-URL nginx
     * не отдаёт — только /api). Поддерживает GET и HEAD.
     */
    public function download(DesktopReleaseSync $sync, string $platform): StreamedResponse
    {
        abort_unless(in_array($platform, ['windows', 'macos'], true), 404);

        $manifest = $sync->manifest();
        $version = $manifest['version'] ?? null;
        $file = $manifest['files'][$platform] ?? null;
        // basename — защита от path traversal на случай битого манифеста
        abort_unless($version && $file && basename($file) === $file, 404);

        $path = DesktopReleaseSync::DIR."/{$version}/{$file}";
        abort_unless(Storage::disk('public')->exists($path), 404);

        // GitHub режет имена ассетов до ASCII («AI._1.1.3_…») — при отдаче
        // подменяем имя на читаемое «Мой AI ассистент_1.1.3_<suffix>».
        $suffix = preg_replace('/^.*?_?\d+\.\d+\.\d+_/', '', $file) ?: $file;
        $downloadName = "Мой AI ассистент_{$version}_{$suffix}";

        return Storage::disk('public')->download($path, $downloadName);
    }

    /**
     * Webhook из CI после публикации GitHub Release: проверка Bearer
     * RELEASE_SYNC_TOKEN и постановка синхронизации в очередь.
     */
    public function sync(Request $request): JsonResponse
    {
        $expected = (string) config('services.release_sync.token', '');
        $given = (string) $request->bearerToken();
        if ($expected === '' || ! hash_equals($expected, $given)) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $data = $request->validate([
            'version' => ['required', 'string', 'max:40'],
        ]);

        DesktopReleaseSyncJob::dispatch(ltrim(trim($data['version']), 'vV'));

        return response()->json(['status' => 'queued'], 202);
    }
}
