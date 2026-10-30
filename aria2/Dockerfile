# Торрент-движок aria2 в режиме JSON-RPC-демона (v1.7.0).
# Только скачивание: сидирование выключено флагами в docker-compose
# (--seed-time=0 --seed-ratio=0.0). /downloads — bind-монт с
# ./data/torrents, тот же каталог app/queue видят как диск «torrents»
# (storage/app/torrents) — staging загрузок вне sync-дерева.
FROM alpine:3.21
RUN apk add --no-cache aria2 ca-certificates
ENTRYPOINT ["aria2c"]
