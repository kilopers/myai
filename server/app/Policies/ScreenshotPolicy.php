<?php

namespace App\Policies;

use App\Models\Screenshot;
use App\Models\User;

class ScreenshotPolicy
{
    /**
     * Determine whether the user can delete the model.
     */
    public function delete(User $user, Screenshot $screenshot): bool
    {
        return $user->is_admin || $screenshot->user_id === $user->id;
    }
}
