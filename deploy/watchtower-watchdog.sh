#!/bin/sh
# Watchdog: возвращает контейнер myai-watchtower-1, если его нет или он упал.
# Установка на хосте (один раз):
#   printf '*/5 * * * * root /docker/myai/deploy/watchtower-watchdog.sh >>/var/log/myai-watchdog.log 2>&1\n' > /etc/cron.d/myai-watchdog
# Зачем: если compose-файл на хосте случайно окажется без сервиса
# watchtower, `docker compose up` молча удалит контейнер как «сироту» —
# и автодеплой тихо умрёт. Крон возвращает его обратно.
set -eu
cd "$(dirname "$0")/.."
if docker ps --format '{{.Names}}' | grep -qx 'myai-watchtower-1'; then
    exit 0
fi
echo "$(date -Iseconds) myai-watchtower-1 отсутствует — пересоздаю"
docker compose up -d watchtower
