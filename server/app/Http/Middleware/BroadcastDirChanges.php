<?php

namespace App\Http\Middleware;

use App\Services\DirChangeTracker;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * После ответа рассылает накопленные за запрос изменения директорий
 * одним событием dirs.changed на канал sync.user.{id}.
 */
class BroadcastDirChanges
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $user = $request->user();
        if ($user !== null) {
            app(DirChangeTracker::class)->flushFor($user);
        }

        return $response;
    }
}
