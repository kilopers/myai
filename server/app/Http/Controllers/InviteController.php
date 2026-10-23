<?php

namespace App\Http\Controllers;

use App\Http\Requests\CreateInviteRequest;
use App\Http\Resources\InviteResource;
use App\Models\Invite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class InviteController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $invites = Invite::with(['creator', 'invitedUser'])
            ->latest()
            ->paginate(25);

        return InviteResource::collection($invites);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(CreateInviteRequest $request): JsonResponse
    {
        $days = $request->integer('expires_in_days') ?: 7;

        $invite = Invite::create([
            'token' => Invite::generateToken(),
            'created_by' => $request->user()->id,
            'expires_at' => now()->addDays($days),
        ]);

        return (new InviteResource($invite))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Invite $invite): JsonResponse
    {
        $invite->delete();

        return response()->json(['message' => 'Invite revoked.']);
    }
}
