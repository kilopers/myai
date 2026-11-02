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
        Schema::create('board_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('board_column_id')->constrained()->cascadeOnDelete();
            $table->string('title', 200);
            $table->text('text')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
        });
    }
};
