<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->softDeletes();
            $table->string('original_path')->nullable();
            $table->unsignedBigInteger('mtime')->nullable();
            $table->string('entry_hash', 64)->nullable();
        });

        Schema::table('screenshots', function (Blueprint $table) {
            $table->softDeletes();
            $table->string('original_path')->nullable();
            $table->unsignedBigInteger('mtime')->nullable();
            $table->string('entry_hash', 64)->nullable();
        });

        Schema::table('folders', function (Blueprint $table) {
            $table->softDeletes();
            $table->string('dir_hash', 64)->nullable();
            $table->boolean('is_system')->default(false);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->unsignedInteger('trash_retention_days')->default(14);
        });

        Schema::create('deleted_files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 16); // file | screenshot | folder
            $table->string('name');
            $table->unsignedBigInteger('size')->default(0);
            $table->unsignedBigInteger('mtime')->nullable();
            $table->string('entry_hash', 64);
            $table->string('dir_path')->default('');
            $table->timestamp('deleted_at');
            $table->timestamps();

            $table->index(['user_id', 'entry_hash']);
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deleted_files');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('trash_retention_days');
        });
        Schema::table('folders', function (Blueprint $table) {
            $table->dropColumn(['deleted_at', 'dir_hash', 'is_system']);
        });
        Schema::table('screenshots', function (Blueprint $table) {
            $table->dropColumn(['deleted_at', 'original_path', 'mtime', 'entry_hash']);
        });
        Schema::table('files', function (Blueprint $table) {
            $table->dropColumn(['deleted_at', 'original_path', 'mtime', 'entry_hash']);
        });
    }
};
