<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('torrents', function (Blueprint $table) {
            // Журнал загрузки: [{t: unixtime, m: строка}] — события и
            // периодические строки статистики, показывается в модалке.
            $table->json('log')->nullable()->after('error');
        });
    }

    public function down(): void
    {
        Schema::table('torrents', function (Blueprint $table) {
            $table->dropColumn('log');
        });
    }
};
