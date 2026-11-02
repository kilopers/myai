<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('torrent_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('torrent_id')->unique()->constrained('torrents')->cascadeOnDelete();
            // 0-based индексы выбранных файлов; NULL — качать все.
            $table->json('selected_indexes')->nullable();
            // Лимит скорости загрузки, байт/с; 0 — без ограничений.
            $table->unsignedBigInteger('max_download_rate')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('torrent_settings');
    }
};
