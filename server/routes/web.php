<?php

use App\Http\Controllers\ScreenshotController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json(['name' => config('app.name'), 'status' => 'ok']));

// Public image serving — unguessable UUID acts as the access key.
Route::get('/i/{uuid}', [ScreenshotController::class, 'file'])
    ->where('uuid', '[0-9a-f-]{36}(\.[a-z0-9]+)?')
    ->name('screenshots.file');
