# syntax=docker/dockerfile:1

# ---------- vendor stage ----------
FROM composer:2 AS vendor
WORKDIR /app
COPY server/composer.json server/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction
COPY server/ .
RUN composer dump-autoload --optimize

# ---------- runtime ----------
FROM php:8.5.12-fpm-alpine3.24

RUN apk add --no-cache \
        freetype-dev \
        icu-dev \
        libjpeg-turbo-dev \
        libpng-dev \
        libzip-dev \
        oniguruma-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && for ext in bcmath gd intl opcache pdo_mysql zip; do \
         docker-php-ext-install -j"$(nproc)" "$ext"; \
       done \
    && rm -rf /var/cache/apk/*

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
