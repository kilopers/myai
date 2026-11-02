<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Обсуждение задачи доски: комментарии с вложениями.
 * Вложения комментария — те же board_task_attachments,
 * помеченные board_task_comment_id.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('board_task_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('board_task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('text')->nullable();
            $table->timestamps();
        });

        Schema::table('board_task_attachments', function (Blueprint $table) {
            $table->foreignId('board_task_comment_id')->nullable()->after('board_task_id')
                ->constrained('board_task_comments')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('board_task_attachments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('board_task_comment_id');
        });
        Schema::dropIfExists('board_task_comments');
    }
};
