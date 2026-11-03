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

    public function test_reorder_tasks_within_column(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'B']);

        $col = $this->actingAs($user)->postJson('/api/board-columns', [
            'board_id' => $board->id, 'name' => 'C',
        ])->assertCreated()->json();

        $ids = [];
        foreach (['A', 'B', 'C'] as $title) {
            $ids[] = $this->actingAs($user)->postJson('/api/board-tasks', [
                'board_column_id' => $col['id'], 'title' => $title,
            ])->assertCreated()->json('id');
        }

        $this->actingAs($user)->putJson('/api/board-columns/'.$col['id'].'/reorder-tasks', [
            'task_ids' => array_reverse($ids),
        ])->assertNoContent();

        $cols = $this->actingAs($user)->getJson('/api/board-columns?board_id='.$board->id)
            ->assertOk()->json();
        $this->assertSame(array_reverse($ids), array_column($cols[0]['tasks'], 'id'));

        // чужой пользователь не может менять порядок
        $other = User::factory()->create();
        $this->actingAs($other)->putJson('/api/board-columns/'.$col['id'].'/reorder-tasks', [
            'task_ids' => $ids,
        ])->assertForbidden();
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

    public function test_task_numbers_and_board_prefix(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'B', 'prefix' => 'PROJ']);
        $col = $board->columns()->create(['name' => 'C', 'color' => '#fff000', 'position' => 0]);

        // Префикс — только латинские заглавные
        $this->actingAs($user)->putJson("/api/boards/{$board->id}", ['name' => 'B', 'prefix' => 'abc'])
            ->assertStatus(422);
        $this->actingAs($user)->putJson("/api/boards/{$board->id}", ['name' => 'B', 'prefix' => 'OK'])
            ->assertOk();

        // Сквозная нумерация задач в рамках доски
        $this->actingAs($user)->postJson('/api/board-tasks', ['board_column_id' => $col->id, 'title' => 'T1'])
            ->assertCreated()->assertJsonPath('number', 1);
        $this->actingAs($user)->postJson('/api/board-tasks', ['board_column_id' => $col->id, 'title' => 'T2'])
            ->assertCreated()->assertJsonPath('number', 2);
    }

    public function test_board_guest_share_link(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'B', 'prefix' => 'PROJ']);
        $col = $board->columns()->create(['name' => 'C', 'color' => '#fff000', 'position' => 0]);
        $this->actingAs($user)->postJson('/api/board-tasks', ['board_column_id' => $col->id, 'title' => 'T']);

        // Ссылка создаётся один раз, повторный запрос отдаёт ту же
        $r1 = $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk();
        $r2 = $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk();
        $this->assertSame($r1->json('url'), $r2->json('url'));

        // Гость видит доску read-only без авторизации
        $token = $board->fresh()->share_token;
        $res = $this->getJson("/api/public/boards/{$token}")->assertOk();
        $this->assertSame('B', $res->json('board.name'));
        $this->assertSame(1, $res->json('columns.0.tasks.0.number'));
    }

    public function test_guest_comments_and_share_revoke(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'B']);
        $col = $board->columns()->create(['name' => 'C', 'color' => '#fff000', 'position' => 0]);
        $this->actingAs($user)->postJson('/api/board-tasks', ['board_column_id' => $col->id, 'title' => 'T']);
        $task = $col->tasks()->first();
        $token = $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk()
            ->json('url') ? $board->fresh()->share_token : null;

        // Гость пишет комментарий под именем — user_id NULL
        $c = $this->postJson("/api/public/boards/{$token}/board-task-comments", [
            'board_task_id' => $task->id, 'guest_name' => 'Иван Петров', 'text' => 'Привет',
        ])->assertCreated();
        $this->assertSame('Иван Петров', $c->json('guest_name'));
        $this->assertNull($c->json('user_id'));
        $this->assertSame(1, $this->getJson("/api/public/boards/{$token}/board-task-comments?board_task_id={$task->id}")
            ->assertOk()->json('*.guest_name') === ['Иван Петров'] ? 1 : 0);

        // Гость удаляет свой комментарий — только под тем же именем
        $this->postJson("/api/public/boards/{$token}/board-task-comments/{$c->json('id')}/delete", [
            'guest_name' => 'Чужой',
        ])->assertForbidden();
        $this->postJson("/api/public/boards/{$token}/board-task-comments/{$c->json('id')}/delete", [
            'guest_name' => 'Иван Петров',
        ])->assertNoContent();

        // Отзыв ссылки — гостевой доступ закрыт
        $this->actingAs($user)->deleteJson("/api/boards/{$board->id}/share-link")->assertNoContent();
        $this->getJson("/api/public/boards/{$token}")->assertNotFound();
    }

    public function test_guest_full_board_editing(): void
    {
        $user = User::factory()->create();
        $board = Board::create(['user_id' => $user->id, 'name' => 'B', 'prefix' => 'X']);
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk();
        $token = $board->fresh()->share_token;
        $base = "/api/public/boards/{$token}";

        // Колонка: создать, переименовать, задача, перенос, удаление
        $col = $this->postJson("{$base}/board-columns", ['name' => 'ToDo', 'color' => '#526de3'])
            ->assertCreated()->json('id');
        $this->putJson("{$base}/board-columns/{$col}", ['name' => 'Doing'])->assertOk();
        $task = $this->postJson("{$base}/board-tasks", ['board_column_id' => $col, 'title' => 'T1'])
            ->assertCreated()->json('id');
        $this->putJson("{$base}/board-tasks/{$task}", ['title' => 'T1*'])->assertOk();
        $col2 = $this->postJson("{$base}/board-columns", ['name' => 'Done'])->assertCreated()->json('id');
        $this->putJson("{$base}/board-tasks/{$task}", ['board_column_id' => $col2])->assertOk();
        $this->putJson("{$base}/board-columns/{$col2}/reorder-tasks", ['task_ids' => [$task]])
            ->assertNoContent();

        // Чужая доска по тому же токену — 404
        $other = Board::create(['user_id' => $user->id, 'name' => 'Secret']);
        $this->putJson("{$base}/board-tasks/{$task}", ['board_column_id' => $other->columns()->create(['name' => 'x', 'position' => 0])->id])
            ->assertNotFound();

        $this->deleteJson("{$base}/board-tasks/{$task}")->assertNoContent();
        $this->deleteJson("{$base}/board-columns/{$col}")->assertNoContent();
    }

    public function test_guest_permissions_limit_actions(): void
    {
        $user = User::factory()->create();
        $board = Board::create([
            'user_id' => $user->id, 'name' => 'B',
            'guest_permissions' => ['columns' => false, 'tasks' => false, 'delete_tasks' => false],
        ]);
        $col = $board->columns()->create(['name' => 'C', 'color' => '#fff000', 'position' => 0]);
        $this->actingAs($user)->postJson('/api/board-tasks', ['board_column_id' => $col->id, 'title' => 'T']);
        $task = $col->tasks()->first();
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk();
        $base = '/api/public/boards/'.$board->fresh()->share_token;

        // Настройки приходят гостю, запрещённые действия — 403
        $res = $this->getJson($base)->assertOk();
        $this->assertFalse($res->json('board.guest_permissions.columns'));
        $this->postJson("{$base}/board-columns", ['name' => 'X'])->assertForbidden();
        $this->postJson("{$base}/board-tasks", ['board_column_id' => $col->id, 'title' => 'T2'])->assertForbidden();
        $this->deleteJson("{$base}/board-tasks/{$task->id}")->assertForbidden();

        // Комментарии и чтение не затронуты
        $this->postJson("{$base}/board-task-comments", [
            'board_task_id' => $task->id, 'guest_name' => 'Гость', 'text' => 'ok',
        ])->assertCreated();

        // Включили всё — работает снова
        $board->update(['guest_permissions' => ['columns' => true, 'tasks' => true, 'delete_tasks' => true]]);
        $this->postJson("{$base}/board-columns", ['name' => 'X'])->assertCreated();
    }

    public function test_guest_column_edit_delete_and_visibility(): void
    {
        $user = User::factory()->create();
        $board = Board::create([
            'user_id' => $user->id, 'name' => 'B',
            'guest_permissions' => ['edit_columns' => false, 'delete_columns' => false],
        ]);
        $col = $board->columns()->create(['name' => 'C', 'position' => 0]);
        $hidden = $board->columns()->create(['name' => 'H', 'position' => 1, 'visible_guests' => false]);
        $this->actingAs($user)->postJson("/api/boards/{$board->id}/share-link")->assertOk();
        $base = '/api/public/boards/'.$board->fresh()->share_token;

        // Редактирование/удаление колонок запрещено настройкой — 403
        $this->putJson("{$base}/board-columns/{$col->id}", ['name' => 'X'])->assertForbidden();
        $this->deleteJson("{$base}/board-columns/{$col->id}")->assertForbidden();

        // Разрешили — правим имя; видимость гостю менять нельзя —
        // поле игнорируется публичным API
        $board->update(['guest_permissions' => ['edit_columns' => true]]);
        $this->putJson("{$base}/board-columns/{$col->id}", [
            'name' => 'X', 'visible_guests' => false,
        ])->assertOk();
        $col->refresh();
        $this->assertSame('X', $col->name);
        $this->assertTrue($col->visible_guests);
    }
}
