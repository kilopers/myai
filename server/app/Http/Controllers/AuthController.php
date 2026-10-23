<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterViaInviteRequest;
use App\Models\Invite;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(LoginRequest $request): JsonResponse
    {
        $user = User::where('email', $request->string('email')->lower()->toString())->first();

        if ($user === null || ! Hash::check($request->string('password')->toString(), $user->password)) {
            throw ValidationException::withMessages([
                'email' => [__('auth.failed')],
            ]);
        }

        return $this->respondWithToken($user, $request->userAgent());
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json($request->user());
    }

    public function changePassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
        ]);

        $user = $request->user();

        if (! Hash::check($validated['current_password'], $user->password)) {
            throw ValidationException::withMessages([
                'current_password' => [__('auth.password')],
            ]);
        }

        $user->update([
            'password' => $validated['password'],
            'must_change_password' => false,
        ]);

        return response()->json(['message' => 'Password changed.']);
    }

    public function showInvite(string $token): JsonResponse
    {
        $invite = Invite::where('token', $token)->first();

        abort_if($invite === null || ! $invite->isUsable(), 404);

        return response()->json(['valid' => true, 'expires_at' => $invite->expires_at->toIso8601String()]);
    }

    public function registerViaInvite(RegisterViaInviteRequest $request, string $token): JsonResponse
    {
        $invite = Invite::where('token', $token)->first();

        abort_if($invite === null || ! $invite->isUsable(), 404);

        $user = User::create([
            'name' => $request->string('name'),
            'email' => $request->string('email')->lower()->toString(),
            'password' => $request->string('password'),
        ]);

        $invite->update([
            'used_by' => $user->id,
            'used_at' => now(),
        ]);

        return $this->respondWithToken($user, $request->userAgent(), 201);
    }

    private function respondWithToken(User $user, ?string $deviceName, int $status = 200): JsonResponse
    {
        $token = $user->createToken($deviceName ?: 'web')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $user,
        ], $status);
    }
}
