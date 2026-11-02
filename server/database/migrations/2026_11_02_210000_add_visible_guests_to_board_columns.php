<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('board_columns', function (Blueprint $table) {
            $table->boolean('visible_guests')->default(true)->after('position');
        });
    }

    public function down(): void
    {
        Schema::table('board_columns', function (Blueprint $table) {
            $table->dropColumn('visible_guests');
        });
    }
};
