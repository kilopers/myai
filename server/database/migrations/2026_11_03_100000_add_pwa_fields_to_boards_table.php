<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('boards', function (Blueprint $table) {
            // Путь к загруженной иконке на public-диске (null — генерится из prefix/имени)
            $table->string('icon')->nullable()->after('guest_permissions');
            // Токен публичного PWA-манифеста владельца (/api/board-apps/{token}/manifest)
            $table->string('manifest_token', 64)->nullable()->unique()->after('icon');
        });

        // Существующим доскам — токены манифеста (новым выставляет Board::boot)
        DB::table('boards')->orderBy('id')->pluck('id')->each(
            fn ($id) => DB::table('boards')->where('id', $id)
                ->update(['manifest_token' => Str::random(48)])
        );
    }

    public function down(): void
    {
        Schema::table('boards', function (Blueprint $table) {
            $table->dropColumn(['icon', 'manifest_token']);
        });
    }
};
