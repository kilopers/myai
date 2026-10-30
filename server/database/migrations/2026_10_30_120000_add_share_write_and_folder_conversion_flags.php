<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            // Отключение фоновой конвертации для всех файлов папки.
            $table->boolean('conversion_enabled')->default(true)->after('default_ttl_days');
        });

        Schema::table('share_links', function (Blueprint $table) {
            // «Разрешить загрузку» для ссылки на папку.
            $table->boolean('can_write')->default(false)->after('expires_at');
        });
    }

    public function down(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->dropColumn('conversion_enabled');
        });
        Schema::table('share_links', function (Blueprint $table) {
            $table->dropColumn('can_write');
        });
    }
};
