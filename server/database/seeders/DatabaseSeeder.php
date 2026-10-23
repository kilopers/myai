<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        User::firstOrCreate(
            ['email' => env('ADMIN_EMAIL', 'admin@screenshoter.local')],
            [
                'name' => 'Admin',
                'password' => env('ADMIN_PASSWORD', 'admin'),
                'is_admin' => true,
                'must_change_password' => true,
            ],
        );
    }
}
