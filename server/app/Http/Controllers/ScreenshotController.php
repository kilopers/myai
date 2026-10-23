<?php

namespace App\Http\Controllers;

use App\Http\Requests\UploadScreenshotRequest;
use App\Http\Resources\ScreenshotResource;
use App\Models\Screenshot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ScreenshotController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $screenshots = $request->user()
            ->screenshots()
            ->latest()
            ->paginate(24);

        return ScreenshotResource::collection($screenshots);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(UploadScreenshotRequest $request): JsonResponse
    {
        $file = $request->file('image');
        $uuid = (string) Str::uuid();
        $extension = strtolower($file->guessExtension() ?: 'png');
        $path = $file->storeAs('screenshots', "{$uuid}.{$extension}", 'public');

        [$width, $height] = getimagesize($file->getRealPath()) ?: [null, null];

        $screenshot = $request->user()->screenshots()->create([
            'uuid' => $uuid,
            'filename' => "{$uuid}.{$extension}",
            'mime_type' => $file->getMimeType(),
            'size' => $file->getSize(),
            'width' => $width,
            'height' => $height,
            'path' => $path,
        ]);

        return (new ScreenshotResource($screenshot))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * Display the specified resource.
     */
    public function show(Screenshot $screenshot): ScreenshotResource
    {
        return new ScreenshotResource($screenshot);
    }

    /**
     * Stream the image file. Public route — unguessable UUID acts as the access key.
     */
    public function file(string $uuid): StreamedResponse
    {
        $uuid = Str::before($uuid, '.');

        $screenshot = Screenshot::where('uuid', $uuid)->firstOrFail();

        abort_unless(Storage::disk('public')->exists($screenshot->path), 404);

        return Storage::disk('public')->response($screenshot->path, $screenshot->filename, [
            'Content-Type' => $screenshot->mime_type,
            'Cache-Control' => 'public, max-age=31536000, immutable',
        ]);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(Screenshot $screenshot): JsonResponse
    {
        Gate::authorize('delete', $screenshot);

        $screenshot->deleteFile();
        $screenshot->delete();

        return response()->json(['message' => 'Deleted.']);
    }
}
