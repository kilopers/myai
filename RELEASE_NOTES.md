# История релизов

Формат версии — «ГЛАВНАЯ.МАЖОРНАЯ.МИНОРНАЯ» (см. инструкцию
«Версионирование»): минорная — при каждом изменении кода, мажорная —
при больших/ломающих изменениях, главная — по решению владельца.
Актуальная версия — в файле `VERSION`.

## 1.0.1

UX-правки веба и десктопа.

- Web/настройки: новая карточка «Синхронизация» — хэш корневой папки
  (`POST /api/sync/hash`, для сверки с десктопом).
- Web/файлы: запрет загрузки файла с именем, которое уже есть в папке
  (проверка списка + идущих загрузок); у записей прогресса уникальный
  id (был key=name — коллизии при повторной загрузке того же файла).
- Web/прогресс загрузки: процент ограничен 100 (multipart-оверхед давал
  101%), ошибка показывается состоянием «ошибка загрузки» (раньше
  провал отмечался как «загружен»), бар исчезает через 3 с после
  успеха (ошибка — через 6 с).
- Desktop: окно «О программе» из меню трея (версия через
  `getVersion()`), настройки показывают хэш корня папки
  (команда `sync_root_hash` — живое дерево или sync.db), высота окна
  настроек 660 → 840 — на macOS всё влезает без ручного ресайза.

## 1.0.0

Автообновление десктопа + единая версия всех компонентов.

- Версии унифицированы в `1.0.0`: корневой `VERSION` — единственный
  источник; `tauri.conf.json` наследует версию из `Cargo.toml` (поле
  `version` удалено), `package.json` web/desktop выровнены.
- Server: сервис `App\Services\DesktopReleaseSync` + команда
  `php artisan app:desktop-release-sync {version?}` — скачивает `.msi`/
  `.exe` (Windows) и `.dmg` (macOS) из GitHub Releases в
  `storage/app/public/desktop/{version}/`, пишет манифест
  `desktop/latest.json`, чистит каталоги старых версий. Идемпотентно,
  при ошибке GitHub API манифест не трогается.
- Server: публичные endpoints `GET /api/desktop-version` (версия +
  self-hosted ссылки + notes_url; без манифеста — fallback на VERSION)
  и `GET /api/desktop-download/{platform}` (раздача файла с нашего
  сервера, 404 без манифеста/файла).
- Server: webhook `POST /api/desktop-release/sync` (Bearer
  `RELEASE_SYNC_TOKEN`, `hash_equals`, иначе 401) →
  `App\Jobs\DesktopReleaseSyncJob` в очередь → sync + broadcast.
- Server: событие `App\Events\UpdateAvailable` (ShouldBroadcast,
  канал `app.updates`, имя `app.update-available`, payload
  version+downloads+notes_url); повторную рассылку той же версии
  отсекает кэш `desktop.release_announced`.
- CI: `release.yml` — новый job `publish` после матрицы сборок:
  `gh release edit --draft=false` (релиз из черновика) + curl webhook
  на сервер (секреты `RELEASE_SYNC_URL`, `RELEASE_SYNC_TOKEN`).
- Desktop: модуль `update.rs` — semver-compare (юнит-тесты), проверка
  `/api/desktop-version` при каждом (ре)коннекте WS-монитора, подписка
  на `app.updates` → `app.update-available` → уведомление
  (notification) + диалог подтверждения (dialog, дедуп по версии).
  Windows: скачивание инсталлятора с нашего сервера → запуск
  (msiexec/exe) → выход. macOS: открытие страницы релиза/dmg +
  подсказка про `xattr -cr`.
- Конфиг: `RELEASE_SYNC_TOKEN` в `services.release_sync.token`,
  docker-compose (app-env) и `.env.example`.

## 0.5.2

Автосинхронизация: FS-watcher + heartbeat корневого хэша.

- Desktop: фоновый `watch_loop` (sync.rs) — `notify`-watcher на папке
  синхронизации; события помечают пути «грязными», через 5 секунд
  тишины хэш пересчитывается инкрементально (файл + предки до корня —
  без полного обхода; дебаунс покрывает «файл в полёте»). Каждые 5 сек
  локальный `root_hash` уходит на `POST /api/sync/hash`; при расхождении
  (`diverged`) запускается синк (кулдаун 15 с). Полный скан — только на
  старте, смене папки или потере событий watcher'а (`stale` → rescan);
  `run_sync` использует живое дерево вместо повторного обхода.
- Server: новый endpoint `POST /api/sync/hash` — принимает локальный
  `root_hash`, отвечает серверным `{root_hash, diverged}` (heartbeat
  ловит изменения обеих сторон: локальные — watcher'ом, серверные —
  расхождением хэша).
- Транспорт heartbeat — HTTPS (не WS): по протоколу Pusher client-events
  в Reverb до бэкенда не доходят — ретранслируются только подписчикам
  канала; канал `sync.user.{id}` по-прежнему несёт `sync.requested`
  сервер→десктоп.
- Тест: `SyncApiTest::test_hash_endpoint_reports_divergence`.

## 0.5.1

Фикс сборки десктопа (CI, `cargo check` на windows-latest):

- `desktop/src-tauri/src/sync.rs`: `filetime::set_file_mtime()` —
  свободная функция крейта, а не ассоциированный метод `FileTime`
  (2 места: копия скриншота в «Скриншоты», скачанный файл).
- Убраны лишние скобки вокруг паттерна в `let … else`
  (`unnecessary parentheses around pattern`, 2 места) и нечитаемые
  поля `parent_id`/`name` у `RemoteFolder`.
- Проверено локально: `cargo check` чисто, `cargo test` — оба
  тест-вектора хэшей проходят.

## 0.5.0

Двусторонняя синхронизация локальной папки с серверным хранилищем
(десктоп ↔ Laravel API ↔ веб) + серверная «Корзина».

- Server/хранилище: единая двухуровневая раскладка `files/{ab}/{cd}/{uuid}.{ext}`
  (Moodle-style) и для файлов, и для скриншотов; хелпер
  `App\Support\StoragePath::file()`; artisan-команда `storage:relayout`
  переносит существующие файлы, проставляет `path`/`mtime`/`entry_hash`/
  `dir_hash` (идемпотентна, вызывается из entrypoint после migrate).
- Server/корзина: `files`, `screenshots`, `folders` — soft-delete с
  `original_path`; любое удаление (веб/синк/expires_at) — в корзину,
  файл на диске остаётся, share-ссылки снимаются. API `/api/trash`:
  список (2 вкладки в вебе), `restore` (цепочка папок пересоздаётся,
  коллизии имён — суффикс «(1)»), удаление насовсем, очистка.
  `users.trash_retention_days` (дефолт 14) — автоочистка в `uploads:prune`.
- Server/tombstones: таблица `deleted_files` (kind/name/size/mtime/
  entry_hash/dir_path/deleted_at) — лог для различения «удалено на
  сервере» и «новый локальный файл»; чистится старше 6 месяцев.
- Server/sync: `GET /api/sync/tree` — дерево папок (dir_hash) + файлов и
  скриншотов (entry_hash, mtime) + tombstones + `root_hash`;
  `GET /api/sync/deleted?since=`; системная неудаляемая папка
  «Скриншоты» (`is_system`, API отклоняет удаление/переименование);
  экшен `sync.branch` — broadcast `sync.requested` на канал
  `sync.user.{id}` (Reverb) для десктопа.
- Server/хэши: `App\Support\SyncHash` — sha256(name|size|mtime) для
  файла, sha256(name|0|dir_hash) для папки, dir_hash = sha256(конкат
  entry_hash детей по name byte-order); содержимое файлов не читается.
  Кэш `folders.dir_hash` с инвалидацией по цепочке вверх.
- Web: папки переехали в левый сайдбар — раскрывающееся дерево
  (вложенность любая, шеврон, ширина панели 300px, компактные отступы),
  действия папки в контекстном меню узла (подпапка, ссылка, TTL,
  переименование, удаление, «Синхронизировать эту ветку»); из центра
  FilesPage папки убраны. В настройках — раздел «Корзина»: срок хранения
  + две вкладки Файлы/Скриншоты с восстановлением и удалением насовсем.
- Desktop: `sync.db` (rusqlite) в app_data_dir — snapshot `entries` +
  `meta`; движок синхронизации (скан по метаданным, Merkle-сравнение
  dir_hash, tombstone-разрешение неоднозначности, конфликт по mtime —
  новее побеждает, заменённая сторона в корзину); загрузка чанками >4МБ
  с прогрессом % и скоростью в логе; выбор папки (dialog) с проверкой
  записи, автосоздание «Скриншоты»; копии сделанных скриншотов кладутся
  в неё с серверным mtime; триггеры — запуск приложения, пункт трея
  «Синхронизировать», кнопка в настройках, WS-событие sync.requested
  (только ветка); живой журнал синхронизации в окне настроек
  (ring buffer в памяти, событие `sync-log`); macOS — ссылка на панель
  «Конфиденциальность и безопасность» в настройках.
- Тесты: SyncHashTest (тест-векторы, паритет PHP↔Rust), TrashTest,
  SyncApiTest, RelayoutStorageTest, PruneTest; FolderTreeTest обновлён
  под soft-delete.
- Локально удалённая «Скриншоты»: содержимое на сервере → корзина,
  папка остаётся, на десктопе пересоздаётся пустой.

## v0.1.0 — 2026-10-23

Первая версия. Скриншот-сервис задеплоен в прод:
https://screen.ai.kilop.ru

- Монорепо: бэкенд `server/` (Laravel 13, PHP 8.5, Sanctum —
  авторизация, инвайты, загрузка/раздача скриншотов, API-токены),
  веб-интерфейс `web/` (React 19 + Vite + MUI), десктоп `desktop/`
  (Tauri 2, Windows + macOS).
- Docker-стек (`docker-compose.yml`): web (nginx) / app (PHP-FPM) /
  queue / db (MySQL 8.4). Данные — bind-монты в проекте:
  `./data/db` и `./data/screenshots` (dev-стек — `./data-dev/`).
- Прод: `/docker/screenshoter` на aidevserver, порт 8282, TLS через
  Traefik + Let's Encrypt.
- Исправления под прод-деплой:
  - `server/Dockerfile`: `COPY` с учётом контекста корня репо;
    последовательная установка PHP-расширений (фикс гонки
    `docker-php-ext-install -j`).
  - `server/docker/entrypoint.sh`: старт от root, `chown` bind-монтов
    под `www-data`, artisan через `su www-data`.
  - `server/bootstrap/app.php`: `trustProxies('*')` — работа за
    reverse-proxy с HTTPS.
- Введено версионирование: файлы `VERSION` и `RELEASE_NOTES.md`.

## v0.1.1 — 2026-10-23

Автодеплой через GHCR + Watchtower.

- Новый workflow `.github/workflows/deploy.yml`: при пуше в `main`
  собирает и пушит образы `ghcr.io/kilopers/screenshoter-server` и
  `ghcr.io/kilopers/screenshoter-web` (теги `latest` и sha коммита),
  шлёт статус деплоя в build.kilop.ru.
- `docker-compose.yml`: сервисам `app`/`queue`/`web` добавлены `image:`
  на GHCR (локальный `build:` сохранён — `up --build` работает как
  раньше), метки скоупа watchtower; добавлен сервис `watchtower`
  (`nickfedor/watchtower`, опрос GHCR каждые 3 мин, только скоуп
  `screenshoter`).
- `.env.example`: опциональные `SERVER_IMAGE`/`WEB_IMAGE`/`IMAGE_TAG`.

## v0.1.2 — 2026-10-23

Фикс автодеплоя: GHCR `permission_denied: read_package`.

- Пакеты `ghcr.io/kilopers/screenshoter-server` и `-web` были созданы
  PAT'ом без привязки к репозиторию — `GITHUB_TOKEN` из Actions писать
  в них не может. Имена образов переведены на вложенные
  `ghcr.io/kilopers/screenshoter/server` и `.../web`: пакет создаётся
  `GITHUB_TOKEN`'ом при первом пуше в `main` и автоматически
  привязывается к репозиторию.
- Старые плоские пакеты-сироты в GHCR можно удалить вручную
  (нужен scope `delete:packages` или веб-интерфейс).

## v0.1.3 — 2026-10-23

Watchtower в отдельный стек + мгновенный триггер деплоя из Actions.

- Watchtower вынесен из `docker-compose.yml` в отдельный стек
  `docker-compose.watchtower.yml` (проект `screenshoter-watchtower`,
  контейнер `screenshoter-watchtower`) — не зависит от `compose down`
  основного стека.
- Включён HTTP API Watchtower (`WATCHTOWER_HTTP_API_MODE`): порт
  `${WATCHTOWER_PORT:-8283}:8080`, Bearer-токен `WATCHTOWER_TOKEN` из
  `.env`, polling каждые 3 мин оставлен страховкой.
- `deploy.yml`: после пуша образов шаг «Trigger watchtower» дёргает
  `POST https://watchtower.ai.kilop.ru/v1/update` (секрет репо
  `WATCHTOWER_TOKEN`) — деплой почти мгновенный, не ждёт опроса.
- Traefik: роутер `watchtower.ai.kilop.ru` → `host.docker.internal:8283`.
- GitHub webhook напрямую несовместим с Watchtower API (GitHub шлёт
  `X-Hub-Signature`, а не `Authorization: Bearer`) — триггер идёт из
  Actions curl'ом.

## v0.1.4 — 2026-10-23

Watchtower возвращён в основной `docker-compose.yml`; доступ к API —
через путь на домене проекта вместо отдельного поддомена.

- Сервис `watchtower` снова в `docker-compose.yml` (HTTP API + Bearer,
  порт 8283), `docker-compose.watchtower.yml` удалён.
- Traefik: убран роутер `watchtower.ai.kilop.ru`; добавлен
  `PathPrefix("/_watchtower")` на `screen.ai.kilop.ru` + middleware
  `stripPrefix` → `POST https://screen.ai.kilop.ru/_watchtower/v1/update`.
- `deploy.yml`: триггер-URL обновлён на `/_watchtower/v1/update`.

## 0.1.5

- Desktop: приложение живёт в трее — закрытие окон скрывает их в системный трей (Windows/macOS), выход только через меню трея; на macOS иконка убрана из Dock (ActivationPolicy::Accessory).
- Desktop: выбор области на ВСЕХ мониторах — по overlay-окну на каждый дисплей, кадр снимается со всех экранов.
- Desktop: «Загрузить» — кнопка отправки выделенной области, прямая публичная ссылка сразу копируется в буфер обмена.
- CI: отчёт о статусе деплоя уходит на https://ai.kilop.ru/api/deploy/status (было build.kilop.ru).

## 0.1.6

- Desktop: галка «Запускать при старте системы» в настройках (tauri-plugin-autostart: LaunchAgent на macOS, реестр на Windows).
- Desktop: capabilities исправлены — overlay-окна теперь `overlay-*` (раньше `overlay` не матчил лейблы `overlay-N`, плагины на оверлее не имели прав).

## 0.1.7

- Desktop fix: мультимонитор с разным DPI/поворотом — overlay-окна ставятся по ФИЗИЧЕСКИМ координатам мониторов Tauri и кадры матчатся по position+size (раньше окна наползали друг на друга на одном экране).
- Desktop: overlay-окна теперь уничтожаются при закрытии (не копятся скрытыми); окно монитора без кадра просто прячется.

## 0.1.8

- Server fix: админ больше не сбрасывает пароль при каждом рестарте — сидер использует `firstOrCreate` вместо `updateOrCreate` (раньше `db:seed` в entrypoint перезатирал пароль и `must_change_password=true` после каждого деплоя → бесконечный экран «Смена пароля»).
- Server: регрессионный тест `AdminSeederTest` — повторный прогон сидера не трогает пароль и флаг.

## 0.1.9

- Desktop fix: починена сборка — случайный дубль `fn open_settings_window` в lib.rs ломал компиляцию (error в release-сборке Windows/macOS).

## 0.2.0

- Web: раздел «Файлы» — папки, drag&drop-загрузка с прогрессом, иконки по типу, публичные ссылки с выбором срока жизни (файл `/f/{token}`, папка `/d/{token}` — список файлов без авторизации).
- Web: сроки хранения — дефолты в настройках (скриншоты/файлы/ссылки), персональный срок у файла и папки; очистка `uploads:prune` почасово через scheduler в queue-контейнере.
- Web: навигация — левый Drawer вместо табов (сворачивается, состояние сохраняется, на мобильном гамбургер); тема — палитра GitLab.
- Web: галерея — адаптивная сетка ~8 в ряд (2 на мобильном), карточка с датой и кнопками в одну ровную строку.
- Web: админ может править имя/email любого юзера включая себя (`PUT /api/admin/users/{id}` + `PUT /api/me`).
- Desktop fix: окно настроек из трея снова открывалось — добавлен `show()`+`unminimize()` (окно пряталось при закрытии).
- Server: лимиты загрузки 100M (php ini + nginx).

## 0.2.1

- Web: палитра переведена на актуальный GitLab — синий primary `#1068bf`, тёмная шапка `#171321`, оранжевый только как акцент; сиреневый убран.
- Web: компактная плотность — theme overrides (карточки с hairline-бордером, уменьшенные паддинги/шрифты, drawer 200px), файлы и галерея мельче.
- Web: dropzone — hover при перетаскивании файла (подсветка, scale, иконка «взлетает», подсказка «Отпусти — файлы загрузятся»).

## 0.2.2

- Web fix: скачивание файлов — отдельная кнопка Download сохраняет с реальным именем файла (a[download]), а не blob-хэшем; клик по карточке по-прежнему открывает просмотр.

## 0.2.3

- CI: ускорена сборка образов — BuildKit layer cache через `type=gha` (server/web) в deploy.yml; повторные сборки без изменений зависимостей идут за секунды.
- CI: релиз — `Swatinem/rust-cache` для cargo (registry+target); macOS собирается только под arm64 (Apple Silicon) вместо universal — вдвое быстрее, dmg arm64.

## 0.2.4

- Web: dropzone перерисована — сплошная серая заливка, скругления, внутренняя тень; при перетаскивании файла зона заметно затемняется в синий, иконка «взлетает», поднимается цветная тень.

## 0.2.5

- Deploy: статус деплоя теперь шлёт сам прод — entrypoint app-контейнера постит `success` по факту старта (после миграций/route:cache) и `failed` по trap ERR; шаг из CI убран (CI присылал статус до реального запуска).

## 0.2.6

- Web: dropzone по референсу — круглая иконка-кнопка в мягком круге, жирный заголовок «Перетащи файлы сюда» + подпись «или нажми, чтобы выбрать», hover обычный и drag-over (заливка, приподнятая тень, иконка в синий круг).

## 0.2.7

- Web: favicon — иконка приложения из desktop (32/128px png + icon.ico + apple-touch-icon) в `web/public`, прописана в index.html.

## 0.2.8

- Web fix: dropzone больше не растягивается на всю ширину ультрашироких экранов — центрированная карточка maxWidth 680, контрастнее заливка/рамка (была почти прозрачной, пунктиры «уезжали» к краям). Список папок и прогресс-бары центрированы той же колонкой.

## 0.2.9

- Desktop: NSIS-инсталлятор Windows на русском языке (`bundle.windows.nsis.languages: ["Russian"]`).

## 0.2.10

- Web: drawer-меню в стиле GitLab — светло-серая панель #f6f6f8, компактные пункты 13px, выделение серым скруглённым прямоугольником + полужирный текст, иконки нейтральные/синие у активного.

## 0.2.11

- Web: drawer по референсу GitLab — лавандово-серая панель #eceef4, выделение «пилюлей» #dcdce9 с полужирным текстом, иконки нейтральные, шрифт 14px.

## 0.2.12

- Web: исправлена дропзона на /files — была Card с component="label" (inline-элемент не содержит блоков, рамка рвалась на пунктирные огрызки). Теперь обычный Box: пунктир, скругление, фон, ховер и подсветка при dragover.

## 0.2.13

- Web: в диалоге «Срок хранения папки» селект был пустым — `default_ttl_days` приходил числом, а MenuItem со строковыми value не совпадали; значение приводится к строке.

## 0.2.14

- Web: внизу drawer-меню показывается текущая версия (маленький серый текст по центру). Версия подставляется из корневого `VERSION` на сборке через `define` в `vite.config.js`.

## 0.2.15

- Deploy: статус деплоя теперь включает версию — `VERSION` копируется в образ сервера (`/var/www/html/VERSION`), entrypoint шлёт `vX.Y.Z` в data вместе с env/url.

## 0.3.0

- Desktop: новый flow скриншота как у Яндекс Диска — оверлей только для выделения области; после mouseup кроп сразу открывается в обычном окне редактора, экран «размораживается». В окне можно дорисовать, отправить или просто закрыть.
- Desktop: тулбар редактора в Material-стиле — SVG-иконки, hover/active-состояния, кнопка «Отправить» акцентная; инструмент по умолчанию — стрелка (была рамка).
- Desktop: в оверлее при выделении показывается бейдж размера области (WxH); Esc — отмена; окно редактора подгоняется под картинку (до 80% экрана).
- Rust: состояние `PendingEdit` + команды `open_editor`/`take_edit`/`hide_editor`; окно `editor` добавлено в capabilities.

## 0.3.1

- Desktop: фикс компиляции — `WebviewWindowBuilder::new` получает `&AppHandle`.

## 0.3.2

- Web: прогресс-бар загрузки файлов — после завершения показывает «загружен» (зелёный), через ~5 сек плавно исчезает вместо мгновенного удаления.

## 0.3.3

- Desktop: фикс зависания после отпускания выделения — `open_editor` закрывал оверлей-окно прямо из invoke, вебвью умирал посреди команды. Теперь закрытие оверлеев и открытие редактора отложены (~120мс) и выполняются на главном потоке.

## 0.3.4

- Desktop: фикс компиляции — лишний clone AppHandle для кложура в `run_on_main_thread`.

## 0.3.5

- Server: лимит загрузки файлов поднят до 8 ГБ — PHP `upload_max_filesize`/`post_max_size` = 8G, `max_input_time`/`max_execution_time` = 3600; nginx `client_max_body_size` = 8g + `fastcgi_read_timeout`; валидация Laravel `max:8388608` КБ.
- Web: версия внизу меню на проде показывала `vdev` — `VERSION` теперь копируется в web-образ, vite.config читает `./VERSION` как фолбэк.

## 0.3.6

- Desktop: окно редактора без системной рамки (тулбар сам по себе заголовок + drag-region); высота окна учитывает тулбар — картинка без скролла.
- Desktop: стрелка крупнее (линия 6px, наконечник 22px), рамка 5px; палитра из 5 цветов в тулбаре (красный/жёлтый/зелёный/синий/чёрный).
- Desktop: текст вводится inline-полем на канвасе («Введите текст») вместо системного prompt().

## 0.3.7

- Desktop: фикс белого окна редактора — `markActive` падал на свотчах (`tools[i].id` на undefined), первый `render()` не вызывался; окно создаётся скрытым и показывается по `editor_ready` после первого кадра.
- Desktop: окно редактора двигается за тулбар — `startDragging` + право `core:window:allow-start-dragging`.

## 0.4.0

- WebSockets: Laravel Reverb — сервис `reverb` в docker-compose (порт `WS_PORT`, прод 8286), роутер Traefik `Host(screen.ai.kilop.ru) && PathPrefix(/app)` → Reverb; публичный `GET /api/ws-config` отдаёт app-key.
- API: единая точка входа `POST /api/action` (`ActionController`) — `screenshots.state/upload/delete`, `files.state/upload/delete`, `folders.create/delete/setTtl`, `share.create/delete`; ответ `{ok, result, state}` — состояние страницы возвращается одним JSON.
- Web: галерея и файлы переведены на `/api/action`; в файлах текущая папка — в URL (`/files?folder=ID`), кнопка «назад» браузера возвращает в предыдущую папку; грид адаптивный без горизонтального скролла.
- Desktop: фоновый WS-монитор к Reverb с автореконнектом (5 сек); точка на иконке трея — зелёная online / красная offline; в настройках после сохранения — проверка соединения и цветной статус.

## 0.4.1

- Desktop: фикс сборки Rust — `Image<'static>` у `ws_icon`, `TrayIconBuilder::with_id("main-tray")` вместо `.id()`.

## 0.4.2

- Server: в образ добавлен ext-pcntl — без него `php artisan reverb:start` падает (`Undefined constant SIGINT`); сокеты на проде подняты.

## 0.4.3

- API: фикс белого экрана — `/api/action` возвращал `state: null` (состояние отдавалось только по флагу `state:true`); теперь `state` приходит всегда.

## 0.4.4

- Desktop: кнопка «Копировать» в редакторе — PNG с канваса (со всеми аннотациями) кладётся в буфер обмена как картинка (команда `copy_screenshot`, уведомление, пермишен `clipboard-manager:allow-write-image`).

## 0.4.5

- Desktop/macOS: явная ad-hoc подпись (`signingIdentity: "-"` в tauri.conf — обязательна для arm64) + инструкция по снятию карантина Gatekeeper (`xattr -cr /Applications/Screenshoter.app`) в описании релиза — ошибка «Приложение повреждено» на M1.

## 0.4.6

- Desktop/macOS: при неудачном захвате экрана — уведомление с подсказкой про право «Запись экрана» (Конфиденциальность и безопасность) и автооткрытие нужной панели системных настроек; раньше захват молча падал без права.

## 0.4.7

- Desktop/macOS: фикс захвата при выданном праве — мониторы Tauri↔xcap не совпадали по размеру на Retina (pt vs px), матчинг не находился → пустые кадры и автооткрытие настроек. Фолбэки: позиция+размер → только позиция (±8) → по индексу монитора.

## 0.4.8

- Server: фикс 500 на `/api/action` и ошибок загрузки файлов — код считал папки вложенными (`parent_id`), а миграция `folders` эту колонку не создавала. Добавлена миграция `add_parent_id_to_folders_table` (self-FK, cascade), связи `parent`/`children` в модели `Folder`, валидация `parent_id` в `folders.create` (только свои папки), рекурсивное удаление дерева папок (файлы с диска + их share-ссылки), `files_count` в состоянии папок.
- Web: подпапки теперь отображаются внутри папки (список показывался только в корне), «назад» ведёт на уровень вверх, хлебные крошки при вложенности > 1.
- Тесты: `FolderTreeTest` — вложенность, чужой `parent_id` (422), каскадное удаление дерева.

## 0.4.9

- Server: устойчивость `/api/action` — сбой при сборке `state` после мутации больше не превращает успешную операцию в 500 (файл загружался, но UI показывал «Не удалось загрузить»): ошибка логируется через `report()`, ответ `state: null`. Для `*.state`-экшенов состояние не пересчитывается дважды — `result` отдаётся как `state`.

## 0.4.10

- Desktop: минимальный размер окна редактора поднят до 720×420 (раньше 460×360 — при выделении маленькой области кнопки инструментов/цветов/«Отправить»/«Копировать» не влезали в тулбар). Маленький кроп теперь открывается в натуральном размере по центру окна на тёмном фоне (#111114) вместо растягивания; уменьшение картинки — только если она больше окна.

## 0.4.11

- Web: в прогресс-баре загрузки файлов теперь показывается скорость (КБ/с, при >1 МБ/с — МБ/с) рядом с процентами.
- Web+Server: чанковая загрузка — файлы больше 4 МБ режутся на части и грузятся последовательно через новый экшен `files.uploadChunk` (чанки складываются в `storage/app/private/chunks/{user}/{upload_id}`, после последнего собираются в финальный файл); размер файла больше не упирается в лимиты POST/nginx — грузятся файлы любого размера. До 4 МБ — прежний прямой `files.upload`.
- Server: `uploads:prune` теперь чистит недособранные чанковые загрузки старше суток.
- Тесты: `ChunkedUploadTest` — сборка чанков в файл и промежуточный `received`.

## 0.4.12

- Desktop/macOS: оверлей выделения области больше не уходит в нативный фулскрин (`toggleFullScreen` создавал отдельный Space и показывал тайтлбар «Screenshoter» с кнопками при подходе курсора к верху экрана). Вместо него — бордерлес-окно `always_on_top` + `visible_on_all_workspaces` на весь монитор в текущем Space: никакой панели, экран не «съезжает». Windows/Linux — прежний фулскрин.
