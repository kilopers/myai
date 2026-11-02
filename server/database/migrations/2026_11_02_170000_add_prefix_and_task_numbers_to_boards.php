<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Префикс доски (PREFIX-N на карточках) и сквозной номер задачи
 * в рамках доски: boards.next_task_number — счётчик, выдаётся на
 * создании; существующие задачи нумеруются по порядку создания.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('boards', function (Blueprint $table) {
            $table->string('prefix', 10)->nullable()->after('name');
            $table->unsignedInteger('next_task_number')->default(1)->after('prefix');
        });

        Schema::table('board_tasks', function (Blueprint $table) {
            $table->unsignedInteger('number')->nullable()->after('board_column_id');
        });

        foreach (DB::table('boards')->pluck('id') as $boardId) {
            $n = 1;
            $taskIds = DB::table('board_tasks')
                ->join('board_columns', 'board_tasks.board_column_id', '=', 'board_columns.id')
                ->where('board_columns.board_id', $boardId)
                ->orderBy('board_tasks.id')
                ->pluck('board_tasks.id');
            foreach ($taskIds as $taskId) {
                DB::table('board_tasks')->where('id', $taskId)->update(['number' => $n++]);
            }
            DB::table('boards')->where('id', $boardId)->update(['next_task_number' => $n]);
        }
    }

    public function down(): void
    {
        Schema::table('board_tasks', function (Blueprint $table) {
            $table->dropColumn('number');
        });
        Schema::table('boards', function (Blueprint $table) {
            $table->dropColumn(['prefix', 'next_task_number']);
        });
    }
};
