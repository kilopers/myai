<?php

namespace App\Http\Controllers;

use App\Models\Folder;
use App\Models\ShareLink;
use App\Models\StoredFile;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PublicShareController extends Controller
{
    public function file(string $token): StreamedResponse
    {
        $link = $this->findLink($token, StoredFile::class);

        $file = $link->linkable;
        abort_unless(Storage::disk('public')->exists($file->path), 404);

        $inline = str_starts_with((string) $file->mime_type, 'image/')
            || $file->mime_type === 'application/pdf'
            || str_starts_with((string) $file->mime_type, 'text/');

        return $inline
            ? Storage::disk('public')->response($file->path, $file->name, [
                'Content-Type' => $file->mime_type ?: 'application/octet-stream',
            ])
            : Storage::disk('public')->download($file->path, $file->name);
    }

    public function folder(string $token): Response
    {
        $link = $this->findLink($token, Folder::class);
        $folder = $link->linkable;

        $rows = $folder->files()->latest()->get()->map(function (StoredFile $f) use ($token) {
            $size = $f->size > 1048576
                ? round($f->size / 1048576, 1).' МБ'
                : round($f->size / 1024, 1).' КБ';
            $url = url("/d/{$token}/{$f->uuid}");

            return '<li><a href="'.e($url).'">'.e($f->name).'</a> <small>'.$size.'</small></li>';
        })->implode('');

        $html = '<!doctype html><meta charset="utf-8"><title>'.e($folder->name)
            .'</title><body style="font-family:sans-serif;max-width:640px;margin:40px auto">'
            .'<h2>Папка: '.e($folder->name).'</h2><ul>'.$rows.'</ul></body>';

        return response($html)->header('Content-Type', 'text/html; charset=utf-8');
    }

    public function folderFile(string $token, string $uuid): StreamedResponse
    {
        $link = $this->findLink($token, Folder::class);

        $file = $link->linkable->files()->where('uuid', $uuid)->firstOrFail();
        abort_unless(Storage::disk('public')->exists($file->path), 404);

        return Storage::disk('public')->response($file->path, $file->name, [
            'Content-Type' => $file->mime_type ?: 'application/octet-stream',
        ]);
    }

    private function findLink(string $token, string $type): ShareLink
    {
        $link = ShareLink::where('token', $token)
            ->where('linkable_type', $type)
            ->firstOrFail();

        abort_if($link->isExpired(), 410);

        return $link;
    }
}
