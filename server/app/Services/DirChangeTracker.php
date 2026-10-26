<?php

namespace App\Services;

use App\Events\DirsChanged;
use App\Models\Folder;
use App\Models\User;
use App\Support\SyncHash;

/**
 * Аккумулятор изменённых директорий в рамках запроса: мутации
 * (загрузка/переименование/удаление/восстановление файлов и папок,
 * изменения галереи скриншотов) отмечаются здесь через SyncHash и
 * контроллеры, а в конце запроса одним событием уходит dirs.changed
 * в канал sync.user.{id}. Зарегистрирован синглтоном — буфер живёт
 * в пределах запроса/команды, flush* очищает его.
 */
class DirChangeTracker
{
    /**
     * @var array<int, array{root: bool, folders: array<int, true>, deleted: array<int, true>, screenshots: bool}>
     */
    private array $changes = [];

    /** Мутация в корне (folder = null): загрузка/удаление файла, папки верхнего уровня. */
    public function markRoot(int $userId): void
    {
        $this->changes[$userId]['root'] = true;
    }

    /** dir_hash папки реально пересчитался. */
    public function markFolder(Folder $folder): void
    {
        $this->changes[$folder->user_id]['folders'][$folder->id] = true;
    }

    /** Папка ушла в корзину/удалена насовсем — хэша больше нет, отдаём null. */
    public function markFolderDeleted(Folder $folder): void
    {
        unset($this->changes[$folder->user_id]['folders'][$folder->id]);
        $this->changes[$folder->user_id]['deleted'][$folder->id] = true;
    }

    /** Галерея скриншотов изменилась (загрузка/удаление/восстановление/TTL). */
    public function markScreenshots(int $userId): void
    {
        $this->changes[$userId]['screenshots'] = true;
    }

    /**
     * Разослать dirs.changed указанному пользователю, если у него есть
     * накопленные изменения, и очистить его буфер. Вызывается из
     * middleware после формирования ответа.
     */
    public function flushFor(User $user): void
    {
        $changes = $this->changes[$user->id] ?? null;
        if ($changes === null) {
            return;
        }
        unset($this->changes[$user->id]);

        $dirs = [];
        // Любое изменение дерева файлов меняет и root_hash (Merkle).
        if (($changes['root'] ?? false) || ($changes['folders'] ?? []) !== [] || ($changes['deleted'] ?? []) !== []) {
            $dirs[] = ['folder_id' => null, 'dir_hash' => SyncHash::rootHash($user)];
        }
        $folderIds = array_keys($changes['folders'] ?? []);
        if ($folderIds !== []) {
            foreach (Folder::where('user_id', $user->id)->whereIn('id', $folderIds)->get() as $folder) {
                $dirs[] = ['folder_id' => $folder->id, 'dir_hash' => $folder->dirHash()];
            }
        }
        foreach (array_keys($changes['deleted'] ?? []) as $id) {
            $dirs[] = ['folder_id' => $id, 'dir_hash' => null];
        }

        $screenshotsHash = ($changes['screenshots'] ?? false)
            ? SyncHash::screenshotsHash($user)
            : null;

        if ($dirs === [] && $screenshotsHash === null) {
            return;
        }

        event(new DirsChanged($user->id, $dirs, $screenshotsHash));
    }

    /**
     * Разослать события всем пользователям с изменениями и очистить
     * буфер — для консольных команд (uploads:prune), где нет
     * request-scoped middleware.
     */
    public function flushAll(): void
    {
        foreach (array_keys($this->changes) as $userId) {
            $user = User::find($userId);
            if ($user !== null) {
                $this->flushFor($user);
            }
        }
    }
}
