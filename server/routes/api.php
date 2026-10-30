<?php

use App\Http\Controllers\ActionController;
use App\Http\Controllers\AdminUserController;
use App\Http\Controllers\ApiTokenController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\DesktopReleaseController;
use App\Http\Controllers\FileController;
use App\Http\Controllers\FolderController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\PublicShareController;
use App\Http\Controllers\ScreenshotController;
use App\Http\Controllers\ShareLinkController;
use App\Http\Controllers\SyncController;
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
});
Route::post('/share/{token}/upload', [PublicShareController::class, 'upload'])
    ->middleware('throttle:30,1');

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
    Route::apiResource('files', FileController::class)->only(['index', 'store', 'update', 'destroy']);
    Route::get('/files/{file}/download', [FileController::class, 'download']);
    // Производные файла фоновой конвертации (v1.3.0)
    Route::get('/files/{file}/thumbnail', [FileController::class, 'thumbnail']);
    Route::get('/files/{file}/pages', [FileController::class, 'pages']);
    Route::get('/files/{file}/pages/{page}', [FileController::class, 'page']);
    Route::get('/files/{file}/converted', [FileController::class, 'converted']);
    Route::post('/share-links', [ShareLinkController::class, 'store']);
    Route::delete('/share-links/{shareLink}', [ShareLinkController::class, 'destroy']);

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
