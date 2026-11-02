<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            // Сумма размеров файлов прямо в папке — кэш, обновляется
            // вместе с dir_hash при пересчёте SyncHash.
            $table->unsignedBigInteger('size')->default(0)->after('dir_hash');
        });

        DB::table('folders')->update([
            'size' => DB::raw('(SELECT COALESCE(SUM(size),0) FROM files WHERE files.folder_id = folders.id)'),
        ]);
    }

    public function down(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->dropColumn('size');
        });
    }
};
