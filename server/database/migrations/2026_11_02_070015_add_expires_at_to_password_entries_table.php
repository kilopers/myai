<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('password_entries', function (Blueprint $table) {
            // NULL — навсегда; по сроку запись удаляет uploads:prune.
            $table->timestamp('expires_at')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::table('password_entries', function (Blueprint $table) {
            $table->dropColumn('expires_at');
        });
    }
};
