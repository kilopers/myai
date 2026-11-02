#!/bin/sh
# Сторож автодеплоя myai: синхронизирует чекаут /docker/myai с origin/main
# и возвращает контейнер myai-watchtower-1, если его нет или он упал.
#
# Установка на хосте (один раз) — скрипт КОПИРУЕТСЯ вне чекаута, чтобы
# крон не зависел от состояния git-чекаута (раньше сторож лежал в репо
# и молча пропадал, когда чекаут застревал на старом коммите):
#   cp /docker/myai/deploy/watchtower-watchdog.sh /usr/local/bin/myai-watchdog.sh
#   chmod +x /usr/local/bin/myai-watchdog.sh
#   printf '*/5 * * * * root /usr/local/bin/myai-watchdog.sh >>/var/log/myai-watchdog.log 2>&1\n' > /etc/cron.d/myai-watchdog
#
# Зачем: если чекаут отстаёт от origin/main, compose-файл из старой версии
# удаляет watchtower-контейнер как «сироту» — и автодеплой тихо умирает.
set -eu
cd /docker/myai
git fetch -q origin && git reset -q --hard origin/main
if docker ps --format '{{.Names}}' | grep -qx 'myai-watchtower-1'; then
    exit 0
fi
echo "$(date -Iseconds) myai-watchtower-1 отсутствует — пересоздаю"
docker compose up -d watchtower
