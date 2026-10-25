<?php

namespace Tests\Unit;

use App\Support\SyncHash;
use PHPUnit\Framework\TestCase;

/**
 * Общие тест-векторы хэшей синхронизации — те же вектора проверяются
 * в Rust-реализации (desktop/src-tauri/src/sync.rs, mod tests).
 * Содержимое файлов не участвует: только имя|размер|mtime.
 */
class SyncHashTest extends TestCase
{
    public function test_file_entry_hash_vector(): void
    {
        $this->assertSame(
            'd5970fd615ddfbfc37772b2936665c3a63be9fb9bcb6688c3ab32d966faf788b',
            SyncHash::file('report.pdf', 1024, 1700000000),
        );
        $this->assertSame(
            '7245b614dc489c4c0375a9fe387e16547b112aa396af2446d7eed6542759eb4a',
            SyncHash::file('a.txt', 3, 100),
        );
    }

    public function test_dir_hash_sorts_children_by_name(): void
    {
        // Дети по name в byte-order: a.txt < b.txt
        $dir = SyncHash::dir([
            ['name' => 'a.txt', 'hash' => SyncHash::file('a.txt', 3, 100)],
            ['name' => 'b.txt', 'hash' => SyncHash::file('b.txt', 5, 200)],
        ]);
        $this->assertSame('00e05b725df4692b3b3a05295705b75f0be733c1e0be4cb6f8effd873c57c27a', $dir);

        // Порядок входа не важен — внутри сортировка
        $dir2 = SyncHash::dir([
            ['name' => 'b.txt', 'hash' => SyncHash::file('b.txt', 5, 200)],
            ['name' => 'a.txt', 'hash' => SyncHash::file('a.txt', 3, 100)],
        ]);
        $this->assertSame($dir, $dir2);
    }

    public function test_folder_entry_hash_vector(): void
    {
        $dir = '00e05b725df4692b3b3a05295705b75f0be733c1e0be4cb6f8effd873c57c27a';
        $this->assertSame(
            '1eddd49fd5a400bc30ebbb39c501bebdca9692b9114b5cc18e7ac9343f0bbcad',
            SyncHash::folderEntry('docs', $dir),
        );
    }

    public function test_empty_dir_hash(): void
    {
        $this->assertSame(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            SyncHash::dir([]),
        );
    }
}
