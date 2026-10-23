#!/bin/sh
set -e

php artisan migrate --force

if [ "${SEED_ADMIN:-true}" = "true" ]; then
    php artisan db:seed --class=DatabaseSeeder --force
fi

php artisan storage:link 2>/dev/null || true
php artisan config:cache
php artisan route:cache

exec php-fpm
