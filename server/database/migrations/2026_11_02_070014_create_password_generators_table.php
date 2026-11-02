<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('password_generators', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('name', 120);
            // Длина генерируемого пароля — случайная в диапазоне [min, max].
            $table->unsignedSmallInteger('min_length');
            $table->unsignedSmallInteger('max_length');
            $table->boolean('use_lower')->default(true);
            $table->boolean('use_upper')->default(true);
            $table->boolean('use_digits')->default(true);
            $table->boolean('use_symbols')->default(false);
            // Собственный набор спецсимволов (подчёркивание и т.п.).
            $table->string('symbols', 100)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('password_generators');
    }
};
