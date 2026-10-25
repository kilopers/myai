# Screenshoter

Монорепо скриншот-сервиса: бэкенд на Laravel (PHP 8.5.12, Docker), веб-интерфейс на React + Material UI, десктоп-приложение на Tauri 2 (Windows + macOS).

## Структура

```
server/    Laravel API — авторизация (Sanctum), инвайты, загрузка и раздача скриншотов
web/       React + Vite + MUI — логин, галерея, админка (инвайты/юзеры), API-токены
desktop/   Tauri 2 — хоткей → выделение области → редактор → загрузка на сервер
```

## Быстрый старт (разработка, без Docker)

Требуется: PHP 8.5 + Composer, Node 24.

```bash
# 1. Бэкенд
cd server
cp .env.example .env   # уже настроен на sqlite
php artisan migrate --seed
php artisan storage:link
php artisan serve      # http://localhost:8000

# 2. Веб-интерфейс
cd web
npm install
npm run dev            # http://localhost:5173 (проксирует /api и /i на :8000)
```

Вход: `admin@screenshoter.local` / `admin` — потребует смены пароля при первом входе.

## Docker (весь стек)

```bash
cp .env.example .env
# Сгенерируй APP_KEY:  cd server && php artisan key:generate --show
docker compose up --build
# http://localhost:8080
```

Данные лежат в bind-монтах внутри проекта, а не в docker volumes: `./data/db` — база MySQL, `./data/screenshots` — загруженные картинки (`/var/www/html/storage/app/public`). Перенос на другой сервер — остановить стек и скопировать папку `data/` вместе с репозиторием и `.env`; бэкап — `tar czf backup.tgz data/ .env` (при остановленном `db`). Права на `./data/screenshots` чинит entrypoint контейнера `app` (он стартует от root и отдаёт каталог `www-data`).

Автодеплой: пуш в `main` → GitHub Actions (`deploy.yml`) собирает образы
`ghcr.io/kilopers/screenshoter-{server,web}` → дёргает HTTP API
Watchtower (`POST https://screen.ai.kilop.ru/_watchtower/v1/update`,
Bearer = секрет `WATCHTOWER_TOKEN`) → Watchtower тянет образы и
пересоздаёт контейнеры (скоуп `screenshoter`, сервис в том же
docker-compose, порт 8283; polling 3 мин — страховка).

Dev-вариант с маунтом кода и Vite dev-сервером (данные — отдельно в `./data-dev/`):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Образ бэкенда — `php:8.5.12-fpm-alpine3.24` (версия с исправлением критических CVE-2026-109618/109619, запинана в `server/Dockerfile`).

## Десктоп-приложение

Требуется: Node 24, Rust (rustup), на Windows — Visual Studio Build Tools (C++).

```bash
cd desktop
npm install
npm run tauri dev
```

Хоткей **Ctrl+Shift+X** — выделение области. После выделения доступны инструменты: рамка, стрелка, текст, блюр, отмена (Ctrl+Z), загрузка. Результат — публичная ссылка в буфере обмена.

Сервер и токен задаются в окне настроек (открывается при первом запуске и из трея). Токен создаётся в веб-интерфейсе → Настройки → API-токены.

> macOS: при первом запуске ОС попросит разрешение «Запись экрана» — Системные настройки → Конфиденциальность и безопасность → Запись экрана.

## Релизы

Единый источник версии — корневой `VERSION` (X.Y.Z); `tauri.conf.json`
наследует версию из `desktop/src-tauri/Cargo.toml`, веб читает `VERSION`
через `__APP_VERSION__`. Релизный коммит — «bump to X.Y.Z»: правит
`VERSION` + `Cargo.toml` + `package.json` (web и desktop) — затем тег:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Пуш тега `v*` запускает GitHub Actions (`release.yml`): собираются
`.msi`/`.exe` (Windows) и `.dmg` (macOS, Apple Silicon), прикладываются
к черновику релиза, затем job `publish` выводит релиз из draft
(`gh release edit --draft=false`) и дёргает webhook
`POST {APP_URL}/api/desktop-release/sync` (Bearer `RELEASE_SYNC_TOKEN` —
секреты `RELEASE_SYNC_URL`/`RELEASE_SYNC_TOKEN` в GitHub Secrets).

Сервер ставит `DesktopReleaseSyncJob` в очередь: артефакты скачиваются из
GitHub Releases в `storage/app/public/desktop/{version}/` (bind-монт
`./data`, переживает редеплой), обновляется манифест `desktop/latest.json`,
клиентам рассылается push `app.update-available` (канал `app.updates`,
Reverb) — один раз на версию. Клиенты качают инсталляторы с нашего
сервера: `GET /api/desktop-version` → ссылки `/api/desktop-download/{platform}`;
ручной прогон — `php artisan app:desktop-release-sync {version?}`.

Сборки неподписанные: на macOS первый запуск — ПКМ → «Открыть»; на Windows — «Подробнее» → «Выполнить в любом случае».

## API (кратко)

| Метод | URL | Описание |
|---|---|---|
| POST | `/api/auth/login` | логин → Bearer-токен |
| POST | `/api/register/{token}` | регистрация по инвайту |
| GET | `/api/invites/{token}` | проверка инвайта |
| POST | `/api/screenshots` | загрузка (multipart `image`, Bearer) |
| GET | `/i/{uuid}.{ext}` | публичная раздача картинки |
| GET/POST/DELETE | `/api/tokens` | API-токены для приложений |
| GET/POST/DELETE | `/api/admin/invites` | инвайты (только админ) |
| GET/DELETE | `/api/admin/users` | пользователи (только админ) |
