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
    const path = new URL(event.request.url).pathname;
    // API, медиа и скачивания — напрямую в сеть: respondWith() не
    // вызываем, запрос уходит нативно (Range-стриминг и browser-
    // download без посредника).
    if (path.startsWith('/api/') || path.startsWith('/i/') ||
        path.startsWith('/f/') || path.startsWith('/d/')) {
        return;
    }
    event.respondWith(fetch(event.request));
});
