<?php

use App\Http\Controllers\AdminUserController;
use App\Http\Controllers\ApiTokenController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\InviteController;
use App\Http\Controllers\ScreenshotController;
use Illuminate\Support\Facades\Route;

// Public
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::get('/invites/{token}', [AuthController::class, 'showInvite'])->name('invites.show');
Route::post('/register/{token}', [AuthController::class, 'registerViaInvite'])->middleware('throttle:register');

// Authenticated
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/change-password', [AuthController::class, 'changePassword']);

    Route::apiResource('screenshots', ScreenshotController::class)->only(['index', 'store', 'show', 'destroy']);

    Route::apiResource('tokens', ApiTokenController::class)->only(['index', 'store', 'destroy']);

    Route::middleware('admin')->prefix('admin')->group(function () {
        Route::apiResource('invites', InviteController::class)->only(['index', 'store', 'destroy']);
        Route::apiResource('users', AdminUserController::class)->only(['index', 'destroy']);
    });
});
