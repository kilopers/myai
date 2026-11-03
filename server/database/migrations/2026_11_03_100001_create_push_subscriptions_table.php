<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('push_subscriptions', function (Blueprint $table) {
            $table->id();
            // Пуши адресуются доске: события на ней уходят только её подписчикам
            $table->foreignId('board_id')->constrained()->cascadeOnDelete();
            // null — подписка гостя гостевой страницы /b/{token}
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->text('endpoint');
            // sha256 endpoint — ключ идемпотентности (endpoint слишком длинный для индекса)
            $table->string('endpoint_hash', 64)->unique();
            // Страница доски, которую открывает пуш (/boards/{id} или /b/{token})
            $table->string('url', 500);
            $table->text('public_key');
            $table->text('auth_token');
            $table->string('content_encoding', 20)->default('aes128gcm');
            $table->timestamps();

            $table->index('board_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_subscriptions');
    }
};
