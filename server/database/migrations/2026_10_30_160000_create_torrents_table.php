<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('torrents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Папка, где лежит .torrent-файл (туда же упадёт результат).
            $table->foreignId('folder_id')->nullable()->constrained()->nullOnDelete();
            // Запись самого .torrent-файла в files.
            $table->foreignId('stored_file_id')->nullable()->constrained('files')->nullOnDelete();
            // Папка с результатом — создаётся по завершении загрузки.
            $table->foreignId('result_folder_id')->nullable()->constrained('folders')->nullOnDelete();
            $table->string('gid', 64)->nullable(); // задача в движке (aria2)
            $table->string('info_hash', 40)->default('');
            $table->string('name');
            // awaiting_selection | downloading | paused | completed | error
            $table->string('status', 24)->default('awaiting_selection');
            // [{index, path, size, selected}] — список файлов торрента.
            $table->json('files')->nullable();
            $table->unsignedBigInteger('total_size')->default(0);
            $table->unsignedBigInteger('downloaded_size')->default(0);
            $table->unsignedTinyInteger('progress')->default(0);
            $table->unsignedBigInteger('download_rate')->default(0);
            $table->string('error', 2000)->nullable();
            $table->timestamps();

            $table->index('status');
        });

        Schema::table('folders', function (Blueprint $table) {
            // auto — .torrent стартует сразу, manual — ждёт выбора файлов.
            $table->string('torrent_mode', 16)->default('auto')->after('conversion_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->dropColumn('torrent_mode');
        });
        Schema::dropIfExists('torrents');
    }
};
