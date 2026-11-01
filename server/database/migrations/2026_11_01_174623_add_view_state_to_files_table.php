<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('files', function (Blueprint $table) {
            // Позиция просмотра: {"page": N} для постраничных,
            // {"seconds": S} для видео. NULL — ни разу не смотрели.
            $table->json('view_state')->nullable()->after('conversion_error');
        });
    }

    public function down(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->dropColumn('view_state');
        });
    }
};
