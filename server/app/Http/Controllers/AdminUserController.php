<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

class AdminUserController extends Controller
{
    /**
     * List all users (admin only).
     */
    public function index(): AnonymousResourceCollection
    {
        $users = User::withCount('screenshots')
            ->orderBy('id')
            ->paginate(25);

        return UserResource::collection($users);
    }

    /**
     * Update user name/email (admin; self-edit allowed).
     */
    public function update(Request $request, User $user): UserResource
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'email' => ['sometimes', 'email', 'max:255',
                Rule::unique('users')->ignore($user->id)],
            'is_admin' => ['sometimes', 'boolean'],
        ]);

        $user->update($validated);

        return new UserResource($user);
    }

    /**
     * Delete a user and all their screenshots (admin only, cannot delete self).
     */
    public function destroy(Request $request, User $user): JsonResponse
    {
        abort_if($user->id === $request->user()->id, 422, 'Cannot delete your own account.');

        foreach ($user->screenshots as $screenshot) {
            $screenshot->deleteFile();
        }

        $user->delete();

        return response()->json(['message' => 'User deleted.']);
    }
}
