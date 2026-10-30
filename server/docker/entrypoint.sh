#!/bin/sh
set -e

# Контроль деплоя: отчёт уходит с ПРОДА по факту запуска (панель «Деплой»).
APP_VERSION=$(cat /var/www/html/VERSION 2>/dev/null || echo '?')
deploy_status() {
    wget -q -T 10 -O /dev/null \
      --header='Content-Type: application/json' \
      --post-data="{\"project\":\"myai\",\"status\":\"$1\",\"data\":\"$2 v${APP_VERSION} env=${APP_ENV:-?} url=${APP_URL:-?}\"}" \
      https://ai.kilop.ru/api/deploy/status >/dev/null 2>&1 || true
}

trap 'deploy_status failed "entrypoint failed"' ERR

# bind-монты из ./data создаются Docker'ом от root — отдаём их www-data
# (public — чтобы www-data мог создать симлинк storage:link)
chown -R www-data:www-data storage bootstrap/cache
chown www-data:www-data public

su -s /bin/sh www-data -c "php artisan migrate --force"

# Раскладка хранилища files/{ab}/{cd}/ + хэши синхронизации (идемпотентно)
su -s /bin/sh www-data -c "php artisan storage:relayout"

if [ "${SEED_ADMIN:-true}" = "true" ]; then
    su -s /bin/sh www-data -c "php artisan db:seed --class=DatabaseSeeder --force"
fi

su -s /bin/sh www-data -c "php artisan storage:link" 2>/dev/null || true
su -s /bin/sh www-data -c "php artisan config:cache"
su -s /bin/sh www-data -c "php artisan route:cache"

deploy_status success "app started" &

exec php-fpm
