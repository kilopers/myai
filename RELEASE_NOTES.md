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
