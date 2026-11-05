<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Запись пароля: url — ссылка на сервис (иконка у названия);
 * share_token + share_expires_at — временная гостевая ссылка на
 * карточку записи (всегда с обязательным сроком жизни).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('password_entries', function (Blueprint $table) {
            $table->string('url', 2048)->nullable()->after('password');
            $table->string('share_token', 64)->nullable()->unique()->after('url');
            $table->timestamp('share_expires_at')->nullable()->after('share_token');
        });
    }

    public function down(): void
    {
        Schema::table('password_entries', function (Blueprint $table) {
            $table->dropUnique(['share_token']);
            $table->dropColumn(['url', 'share_token', 'share_expires_at']);
        });
    }
};
