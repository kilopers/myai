# syntax=docker/dockerfile:1

# Базовый runtime-образ (глобальный ARG — для FROM; в CI
# переопределяется через build-args BASE_IMAGE, см. deploy.yml).
ARG BASE_IMAGE=ghcr.io/kilopers/myai/server-base:1.0

# ---------- vendor stage ----------
FROM composer:2 AS vendor
WORKDIR /app
COPY server/composer.json server/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction
COPY server/ .
RUN composer dump-autoload --optimize

# ---------- runtime ----------
# Базовый образ с системными зависимостями и PHP-расширениями
# (включая ffmpeg/poppler/LibreOffice для конвертации файлов).
# Пересборка и пуш — вручную, см. server/docker/README.md.
# BASE_IMAGE переопределяется в deploy.yml (CI пушит базу тегом
# в прилинкованный пакет myai/server — локальные сборки берут
# server-base из GHCR или собранный локально с тем же тегом).
FROM ${BASE_IMAGE}

COPY server/docker/php/uploads.ini /usr/local/etc/php/conf.d/uploads.ini
COPY server/docker/php/opcache.ini /usr/local/etc/php/conf.d/opcache.ini

WORKDIR /var/www/html

COPY --from=vendor /app /var/www/html
COPY VERSION /var/www/html/VERSION
COPY server/docker/entrypoint.sh /usr/local/bin/app-entrypoint
RUN chmod +x /usr/local/bin/app-entrypoint \
    && chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache

# Entrypoint запускается от root: чинит права на bind-монты из ./data,
# artisan выполняет от www-data, php-fpm мастер от root (воркеры — www-data).
ENTRYPOINT ["app-entrypoint"]
