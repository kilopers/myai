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
    }
}
