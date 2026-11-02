<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * board_tasks.text → longText: описание задачи — HTML из TipTap,
 * в него встраиваются картинки base64 по вставке из буфера —
 * varchar/text слишком малы.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('board_tasks', function (Blueprint $table) {
            $table->longText('text')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('board_tasks', function (Blueprint $table) {
            $table->text('text')->nullable()->change();
        });
    }
};
