<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('folders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->unsignedInteger('default_ttl_days')->nullable();
            $table->timestamps();
        });

        Schema::create('files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('folder_id')->nullable()->constrained()->cascadeOnDelete();
            $table->uuid('uuid')->unique();
            $table->string('name');
            $table->string('filename');
            $table->string('mime_type')->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->string('path');
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        Schema::create('share_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('token', 64)->unique();
            $table->nullableMorphs('linkable');
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        Schema::table('screenshots', function (Blueprint $table) {
            $table->timestamp('expires_at')->nullable()->after('path');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->unsignedInteger('default_screenshot_ttl_days')->nullable();
            $table->unsignedInteger('default_file_ttl_days')->nullable();
            $table->unsignedInteger('default_link_ttl_days')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['default_screenshot_ttl_days', 'default_file_ttl_days', 'default_link_ttl_days']);
        });
        Schema::table('screenshots', function (Blueprint $table) {
            $table->dropColumn('expires_at');
        });
        Schema::dropIfExists('share_links');
        Schema::dropIfExists('files');
        Schema::dropIfExists('folders');
    }
};
