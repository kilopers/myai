<?php

use App\Http\Controllers\ActionController;
use App\Http\Controllers\AdminUserController;
use App\Http\Controllers\ApiTokenController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\FileController;
use App\Http\Controllers\FolderController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\ProfileController;
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
    Route::post('/share-links', [ShareLinkController::class, 'store']);
    Route::delete('/share-links/{shareLink}', [ShareLinkController::class, 'destroy']);

    // Корзина
    Route::get('/trash', [TrashController::class, 'index']);
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
