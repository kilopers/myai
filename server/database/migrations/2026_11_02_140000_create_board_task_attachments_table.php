<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Вложения задач канбан-досок: фото и произвольные файлы.
 * Живут отдельно от files — не участвуют в десктоп-синхронизации,
 * в хэше корневой директории и не отображаются в файловом менеджере.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('board_task_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('board_task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('uuid')->unique();
            $table->string('kind', 8); // photo | file
            $table->string('name');
            $table->string('filename');
            $table->string('mime_type')->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->string('path');
            $table->timestamps();

            $table->index(['user_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('board_task_attachments');
    }
};
