# Docker: базовый образ сервера

`server/Dockerfile` собирается поверх `ghcr.io/kilopers/myai/server-base`
(см. `FROM` в нём). В базовом образе — PHP-FPM со всеми расширениями
проекта и системные бинарники фоновой конвертации файлов:

- `ffmpeg`/`ffprobe` — перекодирование видео в mp4 + poster-кадр;
- `poppler-utils` (`pdfinfo`, `pdftoppm`) — растрирование страниц PDF;
- `libreoffice` (`soffice`) — конвертация doc/docx → pdf;
- `fontconfig` + `ttf-dejavu` — шрифты для LibreOffice.

## Когда пересобирать

Только при изменении `server/Dockerfile.base` (новые apk-пакеты,
обновление базового `php:*` образа). Код приложения в базовый образ
не входит — обычные релизы его не трогают.

## Как пересобрать и запушить

Сборка разовая, локальная (или на прод-хосте, там уже есть login в GHCR):

```bash
# версию тега поднимать при каждой пересборке: :1.0 → :1.1 → …
docker build -f server/Dockerfile.base -t ghcr.io/kilopers/myai/server-base:1.0 .
docker push ghcr.io/kilopers/myai/server-base:1.0
```

После пуша нового тега обновить `FROM` в `server/Dockerfile` и тег
в шаге «Build server base» в `.github/workflows/deploy.yml`.
Образ единый для сервисов `app`, `queue` и `reverb` — менять
docker-compose.yml не нужно.

ВАЖНО: пакет `myai/server-base` в GHCR приватный и НЕ прилинкован к
репозиторию — поэтому:

- в `deploy.yml` база собирается и пушится тегом в ПРИЛИНКОВАННЫЙ
  пакет `myai/server` (`server:base-<версия>`), а сборка server
  получает её через `build-args: BASE_IMAGE=...`;
- локальный `docker compose up --build` требует `docker login ghcr.io`
  ЛИБО однократной локальной сборки базы:
  `docker build -f server/Dockerfile.base -t ghcr.io/kilopers/myai/server-base:1.0 .` —
  buildkit возьмёт локальный образ для `FROM`;
- при желании прилинкуй пакет к репо в настройках пакета на GitHub
  (видимость тогда можно поднять до public — тогда база тянется
  без логина вообще).
