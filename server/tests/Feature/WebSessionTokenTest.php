<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class WebSessionTokenTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_token_is_named_web(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('secret-password'),
        ]);

        $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'secret-password',
        ])->assertOk();

        $this->assertDatabaseHas('personal_access_tokens', [
            'tokenable_id' => $user->id,
            'name' => 'web',
        ]);
    }

    public function test_tokens_list_hides_web_session_tokens(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('secret-password'),
        ]);

        $login = $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'secret-password',
        ])->assertOk();

        $token = $login->json('token');

        $this->withToken($token)->postJson('/api/tokens', [
            'name' => 'desktop-pc',
        ])->assertCreated();

        $names = collect($this->withToken($token)->getJson('/api/tokens')->assertOk()->json())
            ->pluck('name');

        $this->assertContains('desktop-pc', $names);
        $this->assertNotContains('web', $names);
    }
}
