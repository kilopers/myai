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

После пуша нового тега обновить `FROM` в `server/Dockerfile`.
Образ единый для сервисов `app`, `queue` и `reverb` — менять
docker-compose.yml не нужно.

GHCR пакет вложенный (`kilopers/myai/server-base`) — создаётся первым
пушем; чтобы он прилинковался к репозиторию, пушь из GitHub Actions
(`GITHUB_TOKEN`) или вручную добавь связь в настройках пакета.
