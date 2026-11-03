<?php

use App\Http\Controllers\ActionController;
use App\Http\Controllers\AdminUserController;
use App\Http\Controllers\ApiTokenController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BoardColumnController;
use App\Http\Controllers\BoardController;
use App\Http\Controllers\BoardPwaController;
use App\Http\Controllers\BoardTaskAttachmentController;
use App\Http\Controllers\BoardTaskCommentController;
use App\Http\Controllers\BoardTaskController;
use App\Http\Controllers\DesktopReleaseController;
use App\Http\Controllers\FileController;
use App\Http\Controllers\FolderController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\PasswordEntryController;
use App\Http\Controllers\PasswordFolderController;
use App\Http\Controllers\PasswordGeneratorController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\PublicBoardController;
use App\Http\Controllers\PublicShareController;
use App\Http\Controllers\PushSubscriptionController;
use App\Http\Controllers\ScreenshotController;
use App\Http\Controllers\ShareLinkController;
use App\Http\Controllers\StorageController;
use App\Http\Controllers\SyncController;
use App\Http\Controllers\TorrentController;
use App\Http\Controllers\TrashController;
use Illuminate\Support\Facades\Route;

// Public
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::get('/invites/{token}', [AuthController::class, 'showInvite'])->name('invites.show');
Route::post('/register/{token}', [AuthController::class, 'registerViaInvite'])->middleware('throttle:register');

Route::get('/ws-config', function () {
    return response()->json([
        'key' => config('broadcasting.connections.reverb.key'),
        'host' => parse_url(config('app.url'), PHP_URL_HOST) ?: 'localhost',
    ]);
});

// PWA per-board: публичный VAPID-ключ, манифест и иконки по токену
// (share_token — приложение гостя /b/*, manifest_token — владельца
// /boards/*). Bearer при загрузке манифеста браузер не шлёт, защита —
// неугадываемый токен.
Route::get('/push/vapid-key', fn () => response()->json([
    'key' => config('services.webpush.vapid.publicKey'),
]))->middleware('throttle:60,1');
Route::get('/board-apps/{token}/manifest', [BoardPwaController::class, 'manifest']);
Route::get('/board-apps/{token}/icons/{file}', [BoardPwaController::class, 'icon'])
    ->where('file', '(icon|maskable)-(192|512)\.png');

// Публичный просмотр расшаренных ссылок для SPA-страниц /share/*
// (без авторизации — токен ссылки сам по себе ключ доступа).
Route::middleware('throttle:120,1')->group(function () {
    Route::get('/share/{token}', [PublicShareController::class, 'info']);
    Route::get('/share/{token}/file/{uuid}', [PublicShareController::class, 'fileInfo']);
    Route::get('/share/{token}/file/{uuid}/raw', [PublicShareController::class, 'raw']);
    Route::get('/share/{token}/file/{uuid}/download', [PublicShareController::class, 'download']);
    Route::get('/share/{token}/file/{uuid}/thumbnail', [PublicShareController::class, 'thumbnail']);
    Route::get('/share/{token}/file/{uuid}/pages', [PublicShareController::class, 'pages']);
    Route::get('/share/{token}/file/{uuid}/pages/{page}', [PublicShareController::class, 'page']);
    Route::get('/share/{token}/file/{uuid}/converted', [PublicShareController::class, 'converted']);
    Route::get('/share-shot/{uuid}', [PublicShareController::class, 'screenshot']);
    // Гостевая доска по share_token (SPA-страница /b/:token):
    // просмотр + полное редактирование — токен ссылки и есть доступ.
    Route::get('/public/boards/{token}', [PublicBoardController::class, 'show']);
    Route::post('/public/boards/{token}/board-columns', [PublicBoardController::class, 'storeColumn']);
    Route::put('/public/boards/{token}/board-columns/{column}', [PublicBoardController::class, 'updateColumn']);
    Route::delete('/public/boards/{token}/board-columns/{column}', [PublicBoardController::class, 'destroyColumn']);
    Route::put('/public/boards/{token}/board-columns/{column}/reorder-tasks', [PublicBoardController::class, 'reorderTasks']);
    Route::post('/public/boards/{token}/board-tasks', [PublicBoardController::class, 'storeTask']);
    Route::put('/public/boards/{token}/board-tasks/{task}', [PublicBoardController::class, 'updateTask']);
    Route::delete('/public/boards/{token}/board-tasks/{task}', [PublicBoardController::class, 'destroyTask']);
    Route::post('/public/boards/{token}/board-task-attachments', [PublicBoardController::class, 'storeAttachment']);
    Route::get('/public/boards/{token}/board-task-attachments/{attachment}', [PublicBoardController::class, 'showAttachment']);
    Route::delete('/public/boards/{token}/board-task-attachments/{attachment}', [PublicBoardController::class, 'destroyAttachment']);
    Route::get('/public/boards/{token}/board-task-comments', [PublicBoardController::class, 'comments']);
    Route::post('/public/boards/{token}/board-task-comments', [PublicBoardController::class, 'storeComment']);
    Route::post('/public/boards/{token}/board-task-comments/{comment}/delete', [PublicBoardController::class, 'destroyComment']);
    // Push-подписка гостя гостевой страницы доски
    Route::post('/public/boards/{token}/push-subscription', [PublicBoardController::class, 'subscribePush']);
    Route::delete('/public/boards/{token}/push-subscription', [PublicBoardController::class, 'unsubscribePush']);
});
Route::post('/share/{token}/upload', [PublicShareController::class, 'upload'])
    ->middleware('throttle:30,1');

// Стриминг медиа по подписанной HMAC-ссылке (выдаёт /files/{file}/media-url):
// <video>/<a download> не шлют Bearer, поэтому доступ — через sig+exp в query.
Route::get('/files/{file}/media', [FileController::class, 'media'])->name('files.media');

// Автообновление десктопа: версия, раздача инсталляторов, webhook из CI
Route::get('/desktop-version', [DesktopReleaseController::class, 'version'])->middleware('throttle:60,1');
Route::get('/desktop-download/{platform}', [DesktopReleaseController::class, 'download'])->middleware('throttle:60,1');
Route::post('/desktop-release/sync', [DesktopReleaseController::class, 'sync'])->middleware('throttle:10,1');

// Authenticated
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/change-password', [AuthController::class, 'changePassword']);

    Route::post('/action', [ActionController::class, 'handle']);

    Route::put('/me', [ProfileController::class, 'update']);

    Route::apiResource('screenshots', ScreenshotController::class)->only(['index', 'store', 'show', 'update', 'destroy']);

    Route::apiResource('folders', FolderController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::apiResource('password-folders', PasswordFolderController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::apiResource('password-entries', PasswordEntryController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::apiResource('password-generators', PasswordGeneratorController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::post('/password-generators/generate-batch', [PasswordGeneratorController::class, 'generateBatch']);
    Route::post('/password-generators/{passwordGenerator}/generate', [PasswordGeneratorController::class, 'generate']);
    Route::apiResource('boards', BoardController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::post('boards/{board}/share-link', [BoardController::class, 'shareLink']);
    Route::delete('boards/{board}/share-link', [BoardController::class, 'revokeShareLink']);
    // Иконка доски (PWA) и push-подписка владельца
    Route::post('boards/{board}/icon', [BoardController::class, 'storeIcon']);
    Route::delete('boards/{board}/icon', [BoardController::class, 'destroyIcon']);
    Route::post('boards/{board}/push-subscription', [PushSubscriptionController::class, 'store']);
    Route::delete('boards/{board}/push-subscription', [PushSubscriptionController::class, 'destroy']);
    Route::put('board-columns/{board_column}/reorder-tasks', [BoardColumnController::class, 'reorderTasks']);
    Route::apiResource('board-columns', BoardColumnController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::apiResource('board-tasks', BoardTaskController::class)->only(['store', 'update', 'destroy']);
    Route::apiResource('board-task-attachments', BoardTaskAttachmentController::class)->only(['store', 'show', 'destroy']);
    Route::apiResource('board-task-comments', BoardTaskCommentController::class)->only(['index', 'store', 'destroy']);
    Route::apiResource('files', FileController::class)->only(['index', 'store', 'show', 'update', 'destroy']);
    Route::get('/files/{file}/download', [FileController::class, 'download']);
    // Производные файла фоновой конвертации (v1.3.0)
    Route::get('/files/{file}/thumbnail', [FileController::class, 'thumbnail']);
    Route::get('/files/{file}/pages', [FileController::class, 'pages']);
    Route::get('/files/{file}/pages/{page}', [FileController::class, 'page']);
    Route::get('/files/{file}/converted', [FileController::class, 'converted']);
    Route::get('/files/{file}/media-url', [FileController::class, 'mediaUrl']);
    // Позиция просмотра (страница pdf/word, секунды видео)
    Route::get('/files/{file}/position', [FileController::class, 'position']);
    Route::put('/files/{file}/position', [FileController::class, 'savePosition']);
    Route::post('/share-links', [ShareLinkController::class, 'store']);
    Route::delete('/share-links/{shareLink}', [ShareLinkController::class, 'destroy']);

    // Торрент-загрузки (v1.7.0)
    Route::get('/torrents/{torrent}', [TorrentController::class, 'show']);
    Route::post('/torrents/{torrent}/start', [TorrentController::class, 'start']);
    Route::post('/torrents/{torrent}/pause', [TorrentController::class, 'pause']);
    Route::post('/torrents/{torrent}/resume', [TorrentController::class, 'resume']);
    Route::put('/torrents/{torrent}/settings', [TorrentController::class, 'updateSettings']);
    Route::delete('/torrents/{torrent}', [TorrentController::class, 'destroy']);

    // Хранилище: сводка из БД (быстро) и реальный du каталогов (медленно)
    Route::get('/storage/summary', [StorageController::class, 'summary']);
    Route::get('/storage/real-size', [StorageController::class, 'realSize']);

    // Корзина
    Route::get('/trash', [TrashController::class, 'index']);
    Route::get('/trash/log', [TrashController::class, 'log']);
    Route::post('/trash/{type}/{id}/restore', [TrashController::class, 'restore']);
    Route::delete('/trash/{type}/{id}', [TrashController::class, 'destroy']);
    Route::delete('/trash', [TrashController::class, 'clear']);

    // Синхронизация (десктоп)
    Route::get('/sync/tree', [SyncController::class, 'tree']);
    Route::get('/sync/deleted', [SyncController::class, 'deleted']);
    Route::post('/sync/hash', [SyncController::class, 'hash']);

    Route::apiResource('tokens', ApiTokenController::class)->only(['index', 'store', 'destroy']);

    Route::middleware('admin')->prefix('admin')->group(function () {
        Route::apiResource('invites', InviteController::class)->only(['index', 'store', 'destroy']);
        Route::apiResource('users', AdminUserController::class)->only(['index', 'update', 'destroy']);
    });
});
