<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('uploads:prune')->hourly();

// Опрос торрент-движка: команда сама крутится ~50 сек с шагом 2 сек,
// пока есть активные загрузки (withoutOverlapping — страховка от
// накопления при зависшем RPC).
Schedule::command('torrents:poll')->everyMinute()->withoutOverlapping();
