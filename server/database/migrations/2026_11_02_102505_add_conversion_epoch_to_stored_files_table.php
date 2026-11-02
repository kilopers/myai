<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('files', function (Blueprint $table) {
            // Поколение конвертации: каждая постановка инкрементирует —
            // запущенная джоба видит смену поколения и прерывается.
            $table->unsignedInteger('conversion_epoch')->default(0);
        });
    }
};
