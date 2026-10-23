<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ApiTokenController extends Controller
{
    /**
     * List the user's API tokens (for desktop clients).
     */
    public function index(Request $request): JsonResponse
    {
        $tokens = $request->user()->tokens()
            ->latest('id')
            ->get(['id', 'name', 'last_used_at', 'created_at']);

        return response()->json($tokens);
    }

    /**
     * Create a new API token for the desktop app.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
        ]);

        $token = $request->user()->createToken($validated['name']);

        return response()->json([
            'id' => $token->accessToken->id,
            'name' => $validated['name'],
            'token' => $token->plainTextToken,
        ], 201);
    }

    /**
     * Revoke an API token.
     */
    public function destroy(Request $request, int $token): JsonResponse
    {
        $request->user()->tokens()->where('id', $token)->delete();

        return response()->json(['message' => 'Token revoked.']);
    }
}
