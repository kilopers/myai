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
