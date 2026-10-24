# История релизов

Формат версии — «ГЛАВНАЯ.МАЖОРНАЯ.МИНОРНАЯ» (см. инструкцию
«Версионирование»): минорная — при каждом изменении кода, мажорная —
при больших/ломающих изменениях, главная — по решению владельца.
Актуальная версия — в файле `VERSION`.

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
