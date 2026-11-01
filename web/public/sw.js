/**
 * Service Worker для установки PWA (без пуш-уведомлений).
 * Наличие SW с fetch-обработчиком — требование Chrome для
 * установки приложения на домашний экран. Сеть проксируется
 * без кэша: данные всегда свежие, офлайн-режима нет.
 */

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
