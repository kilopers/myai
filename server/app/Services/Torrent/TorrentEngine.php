<?php

namespace App\Services\Torrent;

/**
 * Движок торрент-загрузки (aria2 по JSON-RPC — Aria2Engine). Вынесен
 * в интерфейс, чтобы в тестах подменять реализацию фейком: внешний
 * демон и сеть из тестов не дёргаются.
 */
interface TorrentEngine
{
    /**
     * Поставить торрент на загрузку.
     *
     * @param  string  $contents  сырое содержимое .torrent-файла
     * @param  string  $dir  каталог загрузки (в координатах движка)
     * @param  list<int>|null  $selectIndexes  индексы файлов (0-based);
     *                                         null — качать все
     * @return string — gid задачи в движке
     */
    public function addTorrent(string $contents, string $dir, ?array $selectIndexes = null): string;

    /**
     * Текущее состояние задачи.
     *
     * @return array{status:string, total:int, completed:int, rate:int, error:?string}
     *                                                                                 status: active|paused|complete|error|removed
     */
    public function status(string $gid): array;

    public function pause(string $gid): void;

    public function resume(string $gid): void;

    /** Снять задачу с загрузки (активную или приостановленную). */
    public function remove(string $gid): void;

    /** Удалить запись о завершённой/упавшей задаче из памяти движка. */
    public function purge(string $gid): void;
}
