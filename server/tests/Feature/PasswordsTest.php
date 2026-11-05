<?php

namespace Tests\Feature;

use App\Models\PasswordEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PasswordsTest extends TestCase
{
    use RefreshDatabase;

    public function test_folders_and_entries_crud(): void
    {
        $user = User::factory()->create();

        $folder = $this->actingAs($user)->postJson('/api/password-folders', ['name' => 'Работа'])
            ->assertCreated()->json('data');
        $this->assertSame('Работа', $folder['name']);

        $this->actingAs($user)->postJson('/api/password-folders', ['name' => 'Х'])
            ->assertCreated();
        $this->actingAs($user)->postJson('/api/password-folders', [])
            ->assertUnprocessable();

        $entry = $this->actingAs($user)->postJson('/api/password-entries', [
            'password_folder_id' => $folder['id'],
            'name' => 'GitLab',
            'login' => 'admin@corp',
            'password' => 's3cret!',
            'note' => 'VPN required',
        ])->assertCreated()->json('data');
        $this->assertSame('GitLab', $entry['name']);

        $list = $this->actingAs($user)
            ->getJson("/api/password-entries?password_folder_id={$folder['id']}")
            ->assertOk()->json('data');
        // Пароль приходит расшифрованным — он нужен фронту для copy-to-clipboard.
        $this->assertSame('s3cret!', $list[0]['password']);
        $this->assertSame('admin@corp', $list[0]['login']);

        $this->actingAs($user)->putJson("/api/password-entries/{$entry['id']}", [
            'name' => 'GitLab PRO',
            'password' => 'new-pass',
        ])->assertOk()->assertJsonPath('data.name', 'GitLab PRO');
        $this->assertSame('new-pass', PasswordEntry::find($entry['id'])->password);

        // В БД пароль лежит шифротекстом, не открытым текстом.
        $raw = \DB::table('password_entries')->where('id', $entry['id'])->value('password');
        $this->assertStringNotContainsString('new-pass', $raw);

        $this->actingAs($user)->deleteJson("/api/password-entries/{$entry['id']}")->assertOk();
        $this->assertDatabaseMissing('password_entries', ['id' => $entry['id']]);
    }

    public function test_index_without_folder_returns_all_and_search_matches(): void
    {
        $user = User::factory()->create();
        $work = $user->passwordFolders()->create(['name' => 'Работа']);
        $home = $user->passwordFolders()->create(['name' => 'Личное']);
        $user->passwordEntries()->create([
            'password_folder_id' => $work->id,
            'name' => 'GitLab',
            'login' => 'admin@corp',
            'password' => 'p1',
            'note' => 'VPN required',
        ]);
        $user->passwordEntries()->create([
            'password_folder_id' => $home->id,
            'name' => 'Netflix',
            'login' => 'me@mail',
            'password' => 'p2',
        ]);

        // Без folder_id — весь справочник с именами папок.
        $all = $this->actingAs($user)->getJson('/api/password-entries')->assertOk()->json('data');
        $this->assertCount(2, $all);
        $this->assertSame('Работа', collect($all)->firstWhere('name', 'GitLab')['folder']['name']);

        // Поиск по любому совпадению: имя, логин, описание, папка.
        $this->assertCount(1, $this->actingAs($user)->getJson('/api/password-entries?q=gitlab')->json('data'));
        $this->assertCount(1, $this->actingAs($user)->getJson('/api/password-entries?q=admin@corp')->json('data'));
        $this->assertCount(1, $this->actingAs($user)->getJson('/api/password-entries?q=VPN')->json('data'));
        $this->assertCount(1, $this->actingAs($user)->getJson('/api/password-entries?q=Личное')->json('data'));
        $this->assertCount(0, $this->actingAs($user)->getJson('/api/password-entries?q=zzz')->json('data'));
        // Поиск не привязан к папке: «личное» находит и при folder_id=work? — нет, q+folder совместимы.
        $this->assertCount(0, $this->actingAs($user)
            ->getJson("/api/password-entries?password_folder_id={$work->id}&q=netflix")->json('data'));
    }

    public function test_index_paginates_by_20(): void
    {
        $user = User::factory()->create();
        $folder = $user->passwordFolders()->create(['name' => 'Много']);
        for ($i = 0; $i < 25; $i++) {
            $user->passwordEntries()->create([
                'password_folder_id' => $folder->id,
                'name' => str_pad((string) $i, 3, '0', STR_PAD_LEFT),
                'password' => "p{$i}",
            ]);
        }

        $page1 = $this->actingAs($user)
            ->getJson("/api/password-entries?password_folder_id={$folder->id}")
            ->assertOk()->json();
        $this->assertCount(20, $page1['data']);
        $this->assertSame(25, $page1['meta']['total']);
        $this->assertSame(2, $page1['meta']['last_page']);

        $page2 = $this->actingAs($user)
            ->getJson("/api/password-entries?password_folder_id={$folder->id}&page=2")
            ->assertOk()->json();
        $this->assertCount(5, $page2['data']);
    }

    public function test_users_cannot_touch_foreign_passwords(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();

        $folder = $owner->passwordFolders()->create(['name' => 'Личное']);
        $entry = $owner->passwordEntries()->create([
            'password_folder_id' => $folder->id,
            'name' => 'Bank',
            'login' => 'me',
            'password' => 'topsecret',
        ]);

        $this->actingAs($other)->putJson("/api/password-folders/{$folder->id}", ['name' => 'X'])
            ->assertForbidden();
        $this->actingAs($other)->deleteJson("/api/password-folders/{$folder->id}")
            ->assertForbidden();
        $this->actingAs($other)->putJson("/api/password-entries/{$entry->id}", ['name' => 'X'])
            ->assertForbidden();
        $this->actingAs($other)->deleteJson("/api/password-entries/{$entry->id}")
            ->assertForbidden();
        // Запись в чужую папку не создаётся — exists-правило с user_id.
        $this->actingAs($other)->postJson('/api/password-entries', [
            'password_folder_id' => $folder->id,
            'name' => 'hack',
            'password' => 'x',
        ])->assertUnprocessable();
        // Чужие записи в индекс чужой папки не попадают (пусто, а не 403 — id не раскрываем? folder_id чужой → просто пустой список).
        $this->actingAs($other)
            ->getJson("/api/password-entries?password_folder_id={$folder->id}")
            ->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_deleting_folder_removes_entries(): void
    {
        $user = User::factory()->create();
        $folder = $user->passwordFolders()->create(['name' => 'Временное']);
        $entry = $user->passwordEntries()->create([
            'password_folder_id' => $folder->id,
            'name' => 'Site',
            'password' => 'p',
        ]);

        $this->actingAs($user)->deleteJson("/api/password-folders/{$folder->id}")->assertOk();
        $this->assertDatabaseMissing('password_folders', ['id' => $folder->id]);
        $this->assertDatabaseMissing('password_entries', ['id' => $entry->id]);
    }

    public function test_routes_require_auth(): void
    {
        $this->getJson('/api/password-folders')->assertUnauthorized();
        $this->getJson('/api/password-entries?password_folder_id=1')->assertUnauthorized();
        $this->getJson('/api/password-generators')->assertUnauthorized();
    }

    public function test_generators_crud_and_generate(): void
    {
        $user = User::factory()->create();

        $gen = $this->actingAs($user)->postJson('/api/password-generators', [
            'name' => 'Только цифры',
            'min_length' => 6,
            'max_length' => 8,
            'use_lower' => false,
            'use_upper' => false,
            'use_digits' => true,
            'use_symbols' => false,
        ])->assertCreated()->json('data');
        $this->assertSame(6, $gen['min_length']);

        // Без единого набора символов — 422.
        $this->actingAs($user)->postJson('/api/password-generators', [
            'name' => 'Пустой', 'min_length' => 8, 'max_length' => 8,
            'use_lower' => false, 'use_upper' => false,
            'use_digits' => false, 'use_symbols' => false,
        ])->assertUnprocessable();
        // max < min — 422.
        $this->actingAs($user)->postJson('/api/password-generators', [
            'name' => 'Наоборот', 'min_length' => 20, 'max_length' => 8, 'use_digits' => true,
        ])->assertUnprocessable();

        // Генерация: длина в диапазоне, только цифры.
        for ($i = 0; $i < 20; $i++) {
            $pwd = $this->actingAs($user)
                ->postJson("/api/password-generators/{$gen['id']}/generate")
                ->assertOk()->json('password');
            $this->assertMatchesRegularExpression('/^\d{6,8}$/', $pwd);
        }

        // Чужой алгоритм недоступен.
        $other = User::factory()->create();
        $this->actingAs($other)->postJson("/api/password-generators/{$gen['id']}/generate")
            ->assertForbidden();
        $this->actingAs($other)->deleteJson("/api/password-generators/{$gen['id']}")
            ->assertForbidden();

        $this->actingAs($user)->deleteJson("/api/password-generators/{$gen['id']}")->assertOk();
        $this->assertDatabaseMissing('password_generators', ['id' => $gen['id']]);
    }

    public function test_generate_contains_each_selected_pool(): void
    {
        $user = User::factory()->create();
        $gen = $user->passwordGenerators()->create([
            'name' => 'Полный', 'min_length' => 16, 'max_length' => 16,
            'use_lower' => true, 'use_upper' => true,
            'use_digits' => true, 'use_symbols' => true, 'symbols' => '_-',
        ]);

        $pwd = $this->actingAs($user)
            ->postJson("/api/password-generators/{$gen->id}/generate")
            ->assertOk()->json('password');
        $this->assertSame(16, mb_strlen($pwd));
        $this->assertMatchesRegularExpression('/[a-z]/', $pwd);
        $this->assertMatchesRegularExpression('/[A-Z]/', $pwd);
        $this->assertMatchesRegularExpression('/\d/', $pwd);
        $this->assertMatchesRegularExpression('/[_-]/', $pwd);
    }

    public function test_generate_batch_returns_count_per_generator(): void
    {
        $user = User::factory()->create();
        $a = $user->passwordGenerators()->create([
            'name' => 'Цифры', 'min_length' => 6, 'max_length' => 6,
            'use_lower' => false, 'use_upper' => false, 'use_digits' => true,
        ]);
        $b = $user->passwordGenerators()->create([
            'name' => 'Буквы', 'min_length' => 8, 'max_length' => 8,
            'use_lower' => true, 'use_digits' => false, 'use_upper' => false,
        ]);

        $res = $this->actingAs($user)->postJson('/api/password-generators/generate-batch')
            ->assertOk()->json('passwords');

        $this->assertCount(15, $res[(string) $a->id]);
        $this->assertCount(15, $res[(string) $b->id]);
        foreach ($res[(string) $a->id] as $pwd) {
            $this->assertMatchesRegularExpression('/^\d{6}$/', $pwd);
        }
        foreach ($res[(string) $b->id] as $pwd) {
            $this->assertMatchesRegularExpression('/^[a-z]{8}$/', $pwd);
        }

        // Свой count тоже работает, чужой юзер — свои алгоритмы.
        $this->actingAs($user)->postJson('/api/password-generators/generate-batch', ['count' => 3])
            ->assertOk()->assertJsonCount(3, "passwords.{$a->id}");
    }

    public function test_expired_password_entry_is_pruned(): void
    {
        $user = User::factory()->create();
        $folder = $user->passwordFolders()->create(['name' => 'Временные']);
        $old = $user->passwordEntries()->create([
            'password_folder_id' => $folder->id,
            'name' => 'Протухший', 'password' => 'x',
            'expires_at' => now()->subDay(),
        ]);
        $fresh = $user->passwordEntries()->create([
            'password_folder_id' => $folder->id,
            'name' => 'Живой', 'password' => 'x',
            'expires_at' => now()->addMonth(),
        ]);
        $forever = $user->passwordEntries()->create([
            'password_folder_id' => $folder->id,
            'name' => 'Навсегда', 'password' => 'x',
        ]);

        $this->artisan('uploads:prune')->assertSuccessful();

        $this->assertDatabaseMissing('password_entries', ['id' => $old->id]);
        $this->assertDatabaseHas('password_entries', ['id' => $fresh->id]);
        $this->assertDatabaseHas('password_entries', ['id' => $forever->id]);
    }

    public function test_entry_url_is_stored_and_returned(): void
    {
        $user = User::factory()->create();
        $folder = $user->passwordFolders()->create(['name' => 'Работа']);

        $entry = $this->actingAs($user)->postJson('/api/password-entries', [
            'password_folder_id' => $folder->id,
            'name' => 'GitLab',
            'password' => 'p',
            'url' => 'https://git.corp.example',
        ])->assertCreated()->json('data');
        $this->assertSame('https://git.corp.example', $entry['url']);

        $this->actingAs($user)->putJson("/api/password-entries/{$entry['id']}", ['url' => null])
            ->assertOk()->assertJsonPath('data.url', null);
    }

    public function test_temporary_share_link_lifecycle(): void
    {
        $user = User::factory()->create();
        $folder = $user->passwordFolders()->create(['name' => 'Личное']);
        $entry = $user->passwordEntries()->create([
            'password_folder_id' => $folder->id,
            'name' => 'Netflix',
            'login' => 'me@mail',
            'password' => 'netflix-pass',
            'url' => 'https://netflix.com',
            'note' => 'семейный аккаунт',
        ]);

        // Срок жизни обязателен: без ttl_minutes и с нулём — 422.
        $this->actingAs($user)->postJson("/api/password-entries/{$entry->id}/share-link", [])
            ->assertUnprocessable();
        $this->actingAs($user)->postJson("/api/password-entries/{$entry->id}/share-link", ['ttl_minutes' => 0])
            ->assertUnprocessable();

        $link = $this->actingAs($user)
            ->postJson("/api/password-entries/{$entry->id}/share-link", ['ttl_minutes' => 1440])
            ->assertCreated()->json();
        $this->assertMatchesRegularExpression('#^/p/.{48}$#', $link['url']);

        // Гость без авторизации видит карточку с расшифрованным паролем.
        $card = $this->getJson("/api/public/passwords/{$entry->fresh()->share_token}")
            ->assertOk()->json();
        $this->assertSame('Netflix', $card['name']);
        $this->assertSame('netflix-pass', $card['password']);
        $this->assertSame('https://netflix.com', $card['url']);
        $this->assertSame('семейный аккаунт', $card['note']);

        // Пересоздание: новый токен, старый перестаёт работать.
        $oldToken = $entry->share_token;
        $this->actingAs($user)
            ->postJson("/api/password-entries/{$entry->id}/share-link", ['ttl_minutes' => 60])
            ->assertCreated();
        $this->assertNotSame($oldToken, $entry->fresh()->share_token);
        $this->getJson("/api/public/passwords/{$oldToken}")->assertNotFound();

        // Отзыв ссылки: публичный URL отвечает 404.
        $this->actingAs($user)->deleteJson("/api/password-entries/{$entry->id}/share-link")
            ->assertOk();
        $this->getJson("/api/public/passwords/{$entry->fresh()->share_token}")->assertNotFound();
    }

    public function test_expired_share_link_returns_410(): void
    {
        $user = User::factory()->create();
        $folder = $user->passwordFolders()->create(['name' => 'Личное']);
        $entry = $user->passwordEntries()->create([
            'password_folder_id' => $folder->id,
            'name' => 'Old',
            'password' => 'x',
            'share_token' => 'a'.str_repeat('b', 47),
            'share_expires_at' => now()->subMinute(),
        ]);

        $this->getJson("/api/public/passwords/{$entry->share_token}")->assertGone();
    }

    public function test_share_link_endpoints_require_owner(): void
    {
        $owner = User::factory()->create();
        $other = User::factory()->create();
        $folder = $owner->passwordFolders()->create(['name' => 'Личное']);
        $entry = $owner->passwordEntries()->create([
            'password_folder_id' => $folder->id,
            'name' => 'Bank', 'password' => 'x',
        ]);

        $this->actingAs($other)
            ->postJson("/api/password-entries/{$entry->id}/share-link", ['ttl_minutes' => 60])
            ->assertForbidden();
        $this->actingAs($other)
            ->deleteJson("/api/password-entries/{$entry->id}/share-link")
            ->assertForbidden();
        $this->postJson("/api/password-entries/{$entry->id}/share-link", ['ttl_minutes' => 60])
            ->assertForbidden();
    }
}
