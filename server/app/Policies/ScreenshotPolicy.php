<?php

namespace App\Policies;

use App\Models\Screenshot;
use App\Models\User;

class ScreenshotPolicy
{
    /**
     * Determine whether the user can delete the model.
     */
    /**
     * Determine whether the user can update the model.
     */
    public function update(User $user, Screenshot $screenshot): bool
    {
        return $screenshot->user_id === $user->id;
    }

    public function delete(User $user, Screenshot $screenshot): bool
    {
        return $user->is_admin || $screenshot->user_id === $user->id;
    }
}
