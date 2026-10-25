<?php

namespace App\Services;

use App\Events\UpdateAvailable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * Синхронизация релиза десктопа: раз на релиз забирает артефакты из
 * GitHub Releases (репозиторий публичный, токен не нужен) в постоянное
 * хранилище public-диска и обновляет манифест desktop/latest.json.
 * Клиенты дальше качают инсталляторы с нашего сервера.
 */
class DesktopReleaseSync
{
    public const REPO = 'kilopers/myai';

    public const DIR = 'desktop';

    public const MANIFEST = self::DIR.'/latest.json';

    public const ANNOUNCED_CACHE_KEY = 'desktop.release_announced';

    private const USER_AGENT = 'myai-release-sync';

    /**
     * Скачать артефакты релиза v{version} в desktop/{version}/ и
     * переписать latest.json. Идемпотентно: готовые файлы пропускаются,
     * недостающие докачиваются. При ошибке GitHub API бросает
     * RuntimeException, существующий манифест не трогается.
     *
     * @return array{version: string, files: array<string, string>, notes_url: string, fetched_at: string}
     */
    public function sync(string $version): array
    {
        $version = ltrim(trim($version), 'vV');
        $disk = Storage::disk('public');

        $release = Http::acceptJson()
            ->withUserAgent(self::USER_AGENT)
            ->timeout(30)
            ->get('https://api.github.com/repos/'.self::REPO."/releases/tags/v{$version}");

        if (! $release->successful()) {
            throw new RuntimeException(
                "GitHub API вернул {$release->status()} для v{$version} — релиз не найден или ещё draft."
            );
        }

        $assets = collect($release->json('assets') ?? []);

        $pick = function (string $extension) use ($assets): ?array {
            return $assets->first(
                fn (array $a) => str_ends_with(strtolower((string) ($a['name'] ?? '')), $extension)
            );
        };

        // Windows: предпочитаем .msi, fallback — .exe; macOS — .dmg.
        $wanted = [
            'windows' => $pick('.msi') ?? $pick('.exe'),
            'macos' => $pick('.dmg'),
        ];

        $dir = self::DIR."/{$version}";
        $disk->makeDirectory($dir);

        $files = [];
        foreach ($wanted as $platform => $asset) {
            if (! $asset) {
                continue;
            }
            $name = basename((string) $asset['name']);
            $path = "{$dir}/{$name}";
            $files[$platform] = $name;

            if ($disk->exists($path)) {
                continue;
            }

            $part = "{$path}.part";
            $response = Http::withUserAgent(self::USER_AGENT)
                ->timeout(600)
                ->sink($disk->path($part))
                ->get($asset['browser_download_url']);

            if (! $response->successful()) {
                $disk->delete($part);
                throw new RuntimeException(
                    "Не удалось скачать {$name}: HTTP {$response->status()}"
                );
            }
            $disk->move($part, $path);
        }

        $manifest = [
            'version' => $version,
            'files' => $files,
            'notes_url' => $release->json('html_url')
                ?: 'https://github.com/'.self::REPO."/releases/tag/v{$version}",
            'fetched_at' => now()->toIso8601String(),
        ];

        $disk->put(self::MANIFEST, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        // Инсталляторы по ~100–200 МБ — старые версии не копим.
        foreach ($disk->directories(self::DIR) as $old) {
            if (basename($old) !== $version) {
                $disk->deleteDirectory($old);
            }
        }

        return $manifest;
    }

    /**
     * @return array{version?: string, files?: array<string, string>, notes_url?: string}|null
     */
    public function manifest(): ?array
    {
        $disk = Storage::disk('public');
        if (! $disk->exists(self::MANIFEST)) {
            return null;
        }

        $data = json_decode((string) $disk->get(self::MANIFEST), true);

        return is_array($data) ? $data : null;
    }

    /**
     * Ссылки на скачивание с нашего сервера — только для платформ,
     * у которых файл реально есть в манифесте.
     *
     * @return array<string, string>
     */
    public function downloads(?array $manifest): array
    {
        $downloads = [];
        foreach (($manifest['files'] ?? []) as $platform => $file) {
            $downloads[$platform] = "/api/desktop-download/{$platform}";
        }

        return $downloads;
    }

    /**
     * Версия приложения из файла VERSION (в образе лежит рядом с
     * base_path, при локальной разработке — на уровень выше server/).
     */
    public function appVersion(): string
    {
        foreach ([base_path('VERSION'), base_path('../VERSION')] as $file) {
            if (is_file($file)) {
                $version = trim((string) file_get_contents($file));
                if ($version !== '') {
                    return $version;
                }
            }
        }

        return '0.0.0';
    }

    /**
     * Разослать push «доступна новая версия» всем клиентам — один раз
     * на версию (последняя анонсированная хранится в кэше).
     */
    public function broadcastIfNew(array $manifest): bool
    {
        $version = $manifest['version'] ?? null;
        if (! is_string($version) || $version === '') {
            return false;
        }
        if (Cache::get(self::ANNOUNCED_CACHE_KEY) === $version) {
            return false;
        }

        event(new UpdateAvailable(
            version: $version,
            downloads: $this->downloads($manifest),
            notesUrl: $manifest['notes_url'] ?? null,
        ));
        Cache::forever(self::ANNOUNCED_CACHE_KEY, $version);

        return true;
    }
}
