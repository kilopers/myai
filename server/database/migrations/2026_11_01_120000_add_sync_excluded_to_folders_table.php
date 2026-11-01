<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            // Папка (со всем поддеревом) не синхронизируется на компьютер
            // и не участвует в dir_hash родителей / root_hash.
            $table->boolean('sync_excluded')->default(false)->after('torrent_mode');
        });
    }

    public function down(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->dropColumn('sync_excluded');
        });
    }
};
