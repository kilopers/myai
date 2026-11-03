<?php

namespace App\Providers;

use App\Services\DirChangeTracker;
use App\Services\Torrent\Aria2Engine;
use App\Services\Torrent\TorrentEngine;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Minishlink\WebPush\WebPush;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Буфер изменённых директорий — единый на запрос/команду.
        $this->app->singleton(DirChangeTracker::class);

        // Движок торрент-загрузок — в тестах подменяется фейком через
        // app->instance(TorrentEngine::class, ...).
        $this->app->bind(TorrentEngine::class, Aria2Engine::class);

        // Web Push: VAPID-аутентификация из конфига; в тестах
        // подменяется фейком через app->instance(WebPush::class, ...).
        $this->app->bind(WebPush::class, function () {
            $vapid = config('services.webpush.vapid');

            return new WebPush(
                ($vapid['publicKey'] ?? null) ? ['VAPID' => $vapid] : [],
                ['TTL' => 60 * 60 * 24],
            );
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('login', function (Request $request) {
            return Limit::perMinute(5)->by(Str::transliterate(
                Str::lower($request->string('email')).'|'.$request->ip()
            ));
        });

        RateLimiter::for('register', function (Request $request) {
            return Limit::perMinute(5)->by($request->ip());
        });
    }
}
