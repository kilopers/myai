/**
 * Service Worker PWA: installability + Web Push уведомлений досок.
 * Один SW на root-scope обслуживает все «приложения досок» —
 * принадлежность пуша доске определяется подпиской (endpoint),
 * а не worker'ом. Сеть проксируется без кэша: данные всегда свежие,
 * офлайн-режима нет.
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

// Web Push: payload {title, body, icon, tag, url} — шлёт бэкенд
// при событиях на доске (новая задача, новый комментарий).
self.addEventListener('push', (event) => {
    if (!event.data) return;
    let n;
    try {
        n = event.data.json();
    } catch {
        n = { title: event.data.text() };
    }
    event.waitUntil(
        self.registration.showNotification(n.title || 'Уведомление', {
            body: n.body || '',
            icon: n.icon || '/icons/icon-192.png',
            badge: n.icon || '/icons/icon-192.png',
            tag: n.tag,
            data: { url: n.url || '/' },
        }),
    );
});

// Тап по пушу: фокус уже открытой страницы доски или новое окно.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    const target = new URL(url, self.location.origin);
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const c of list) {
                if (new URL(c.url).pathname === target.pathname) {
                    return c.focus().then((w) => w.navigate(target.href));
                }
            }
            return self.clients.openWindow(target.href);
        }),
    );
});
