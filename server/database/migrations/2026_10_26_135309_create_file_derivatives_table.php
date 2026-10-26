<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_derivatives', function (Blueprint $table) {
            $table->id();
            $table->foreignId('file_id')->constrained('files')->cascadeOnDelete();
            $table->string('kind', 16); // thumbnail | page | video | pdf | poster
            $table->unsignedInteger('page_number')->nullable();
            $table->string('path');
            $table->string('mime_type')->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->timestamps();

            $table->index(['file_id', 'kind']);
        });

        Schema::table('files', function (Blueprint $table) {
            $table->string('conversion_status', 16)->default('none'); // none | pending | processing | done | failed
            $table->unsignedTinyInteger('conversion_progress')->default(0);
            $table->unsignedInteger('pages_total')->nullable();
            $table->unsignedInteger('pages_done')->nullable();
            $table->text('conversion_error')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->dropColumn(['conversion_status', 'conversion_progress', 'pages_total', 'pages_done', 'conversion_error']);
        });
        Schema::dropIfExists('file_derivatives');
    }
};
