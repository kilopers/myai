<?php

use App\Http\Controllers\PublicShareController;
use App\Http\Controllers\ScreenshotController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json(['name' => config('app.name'), 'status' => 'ok']));

// Public image serving — unguessable UUID acts as the access key.
Route::get('/i/{uuid}', [ScreenshotController::class, 'file'])
    ->where('uuid', '[0-9a-f-]{36}(\.[a-z0-9]+)?')
    ->name('screenshots.file');

// Public shared links — unguessable token + optional expiry.
Route::get('/f/{token}', [PublicShareController::class, 'file'])->name('share.file');
Route::get('/d/{token}', [PublicShareController::class, 'folder'])->name('share.folder');
Route::get('/d/{token}/{uuid}', [PublicShareController::class, 'folderFile'])->name('share.folder-file');
