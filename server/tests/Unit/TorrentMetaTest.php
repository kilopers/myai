<?php

namespace Tests\Unit;

use App\Services\Torrent\TorrentMeta;
use App\Support\BencodeException;
use PHPUnit\Framework\TestCase;

class TorrentMetaTest extends TestCase
{
    private function fixture(): string
    {
        $raw = file_get_contents(__DIR__.'/../fixtures/sample.torrent');
        $this->assertNotFalse($raw);

        return $raw;
    }

    public function test_parses_real_torrent_fixture(): void
    {
        $meta = TorrentMeta::parse($this->fixture());

        $this->assertSame('Test Release', $meta->name);
        $this->assertSame('7f5e8aa800973aa6f4aa721153b5008e9d43c09f', $meta->infoHash);
        $this->assertSame(500 + 2048 + 100, $meta->totalSize);
        $this->assertSame([
            ['index' => 0, 'path' => 'video.bin', 'size' => 500],
            ['index' => 1, 'path' => 'docs/file.pdf', 'size' => 2048],
            ['index' => 2, 'path' => 'docs/sub/nested.txt', 'size' => 100],
        ], $meta->files);
    }

    public function test_single_file_torrent(): void
    {
        $raw = 'd4:infod6:lengthi42e4:name8:file.bin12:piece lengthi262144e6:pieces20:'.str_repeat("\xAA", 20).'ee';
        $meta = TorrentMeta::parse($raw);

        $this->assertSame('file.bin', $meta->name);
        $this->assertSame([['index' => 0, 'path' => 'file.bin', 'size' => 42]], $meta->files);
        $this->assertSame(42, $meta->totalSize);
    }

    public function test_broken_torrent_throws(): void
    {
        $this->expectException(BencodeException::class);
        TorrentMeta::parse('not a torrent at all');
    }

    public function test_torrent_without_info_throws(): void
    {
        $this->expectException(BencodeException::class);
        TorrentMeta::parse('d8:announce3:urle');
    }
}
