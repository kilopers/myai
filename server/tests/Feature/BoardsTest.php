<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BoardsTest extends TestCase
{
    use RefreshDatabase;

    public function test_boards_crud_search_and_pagination(): void
    {
        $user = User::factory()->create();

        $board = $this->actingAs($user)->postJson('/api/boards', ['name' => 'Проекты'])
            ->assertCreated()->json();
        $this->assertSame('Проекты', $board['name']);

        $this->actingAs($user)->postJson('/api/boards', [])
            ->assertUnprocessable();

        $this->actingAs($user)->putJson('/api/boards/'.$board['id'], ['name' => 'Задачи'])
            ->assertOk()->assertJsonPath('name', 'Задачи');

        for ($i = 0; $i < 22; $i++) {
            $this->actingAs($user)->postJson('/api/boards', ['name' => 'Д'.$i])
                ->assertCreated();
        }

        $page = $this->actingAs($user)->getJson('/api/boards')
            ->assertOk()->json();
        $this->assertSame(20, $page['per_page']);
        $this->assertSame(23, $page['total']);

        $found = $this->actingAs($user)->getJson('/api/boards?q=Задачи')
            ->assertOk()->json();
        $this->assertSame(1, $found['total']);
        $this->assertSame('Задачи', $found['data'][0]['name']);

        $all = $this->actingAs($user)->getJson('/api/boards?all=1')
            ->assertOk()->json();
        $this->assertCount(23, $all);

        $this->actingAs($user)->deleteJson('/api/boards/'.$board['id'])
            ->assertNoContent();
    }

    public function test_columns_and_tasks_flow(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'B']);

        $col = $this->actingAs($user)->postJson('/api/board-columns', [
            'board_id' => $board->id, 'name' => 'Новые', 'color' => '#e3a726',
        ])->assertCreated()->json();
        $this->assertSame('#e3a726', $col['color']);

        $col2 = $this->actingAs($user)->postJson('/api/board-columns', [
            'board_id' => $board->id, 'name' => 'Готово',
        ])->assertCreated()->json();
        $this->assertGreaterThan($col['position'], $col2['position']);

        $task = $this->actingAs($user)->postJson('/api/board-tasks', [
            'board_column_id' => $col['id'], 'title' => 'Купить молоко', 'text' => '2 литра',
        ])->assertCreated()->json();
        $this->assertSame($col['id'], $task['board_column_id']);

        // перенос задачи во вторую колонку
        $moved = $this->actingAs($user)->putJson('/api/board-tasks/'.$task['id'], [
            'board_column_id' => $col2['id'],
        ])->assertOk()->json();
        $this->assertSame($col2['id'], $moved['board_column_id']);

        $cols = $this->actingAs($user)->getJson('/api/board-columns?board_id='.$board->id)
            ->assertOk()->json();
        $this->assertCount(2, $cols);
        $this->assertCount(0, $cols[0]['tasks']);
        $this->assertCount(1, $cols[1]['tasks']);
        $this->assertSame('Купить молоко', $cols[1]['tasks'][0]['title']);

        $this->actingAs($user)->putJson('/api/board-tasks/'.$task['id'], [
            'title' => 'Купить хлеб',
        ])->assertOk()->assertJsonPath('title', 'Купить хлеб');

        $this->actingAs($user)->deleteJson('/api/board-tasks/'.$task['id'])
            ->assertNoContent();
        $this->actingAs($user)->deleteJson('/api/board-columns/'.$col2['id'])
            ->assertNoContent();
    }

    public function test_foreign_boards_are_forbidden(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $board = Board::create(['user_id' => $owner->id, 'name' => 'B']);

        $col = $this->actingAs($owner)->postJson('/api/board-columns', [
            'board_id' => $board->id, 'name' => 'C',
        ])->assertCreated()->json();
        $task = $this->actingAs($owner)->postJson('/api/board-tasks', [
            'board_column_id' => $col['id'], 'title' => 'T',
        ])->assertCreated()->json();

        $this->actingAs($other)->putJson('/api/boards/'.$board->id, ['name' => 'X'])
            ->assertForbidden();
        $this->actingAs($other)->postJson('/api/board-columns', [
            'board_id' => $board->id, 'name' => 'X',
        ])->assertForbidden();
        $this->actingAs($other)->postJson('/api/board-tasks', [
            'board_column_id' => $col['id'], 'title' => 'X',
        ])->assertForbidden();
        $this->actingAs($other)->putJson('/api/board-tasks/'.$task['id'], ['title' => 'X'])
            ->assertForbidden();
        $this->actingAs($other)->getJson('/api/boards?q=B')
            ->assertOk()->assertJsonPath('total', 0);
    }
}
