#!/bin/sh
set -e

# bind-монты из ./data создаются Docker'ом от root — отдаём их www-data
chown -R www-data:www-data storage bootstrap/cache

su -s /bin/sh www-data -c "php artisan migrate --force"

if [ "${SEED_ADMIN:-true}" = "true" ]; then
    su -s /bin/sh www-data -c "php artisan db:seed --class=DatabaseSeeder --force"
fi

su -s /bin/sh www-data -c "php artisan storage:link" 2>/dev/null || true
su -s /bin/sh www-data -c "php artisan config:cache"
su -s /bin/sh www-data -c "php artisan route:cache"

exec php-fpm
