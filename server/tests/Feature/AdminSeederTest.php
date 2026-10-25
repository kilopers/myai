<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_seeder_does_not_reset_existing_admin_password_flag(): void
    {
        $this->seed(DatabaseSeeder::class);

        $admin = User::where('email', env('ADMIN_EMAIL', 'admin@myai.local'))->firstOrFail();
        $admin->update([
            'password' => 'user-changed-password',
            'must_change_password' => false,
        ]);

        $this->seed(DatabaseSeeder::class);

        $admin->refresh();
        $this->assertFalse((bool) $admin->must_change_password);
        $this->assertTrue(Hash::check('user-changed-password', $admin->password));
    }
}
