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
     * @param  int  $maxDownloadRate  лимит скорости, байт/с; 0 — без ограничений
     * @return string — gid задачи в движке
     */
    public function addTorrent(string $contents, string $dir, ?array $selectIndexes = null, int $maxDownloadRate = 0): string;

    /**
     * Смена опций живой задачи (select-file, max-download-limit) —
     * применение настроек без перезапуска загрузки.
     *
     * @param  array<string, string>  $options  опции в терминах aria2
     */
    public function changeOptions(string $gid, array $options): void;

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
