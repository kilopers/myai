<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Комментарии гостей на публичной доске: user_id необязателен —
 * для гостевых сообщений хранится полное имя в guest_name.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('board_task_comments', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id')->nullable()->change();
            $table->string('guest_name')->nullable()->after('user_id');
        });
    }

    public function down(): void
    {
        Schema::table('board_task_comments', function (Blueprint $table) {
            $table->dropColumn('guest_name');
            $table->unsignedBigInteger('user_id')->nullable(false)->change();
        });
    }
};
