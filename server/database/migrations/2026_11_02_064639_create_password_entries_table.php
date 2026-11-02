<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('password_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('password_folder_id')->constrained('password_folders')->cascadeOnDelete();
            $table->string('name', 200);
            $table->string('login')->nullable();
            // TEXT: шифротекст из encrypted-каста длиннее исходного пароля.
            $table->text('password');
            $table->text('note')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('password_entries');
    }
};
