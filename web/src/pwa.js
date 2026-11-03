// PWA per-board: хелперы push-подписок и install-поддержки.
// Одна SW-подписка (endpoint) на origin — сервер связывает её с
// доской через push_subscriptions, поэтому один endpoint может
// быть подписан сразу на несколько досок.

const EP_KEY = 'myai:push-endpoint';

/** Endpoint текущей PushSubscription — шлём как exclude_endpoint,
 *  чтобы автор действия не получал пуш о собственном действии. */
export const pushEndpoint = () => localStorage.getItem(EP_KEY);

export const savePushEndpoint = (endpoint) => {
  if (endpoint) localStorage.setItem(EP_KEY, endpoint);
  else localStorage.removeItem(EP_KEY);
};

/** Ключ локального флага «подписан/отписан» конкретной доски. */
export const boardSubKey = (boardKey) => `myai:push:board:${boardKey}`;

export const boardSubState = (boardKey) => localStorage.getItem(boardSubKey(boardKey));

export const saveBoardSubState = (boardKey, state) => {
  if (state) localStorage.setItem(boardSubKey(boardKey), state);
  else localStorage.removeItem(boardSubKey(boardKey));
};

/** Поддержка Push API в этом браузере. */
export const pushSupported = () => (
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
);

/** base64url → Uint8Array для applicationServerKey. */
export const urlBase64ToUint8Array = (base64) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

/** ArrayBuffer → base64url (ключи подписки для сервера). */
export const arrayBufferToBase64Url = (buf) => {
  const bytes = new Uint8Array(buf);
  let str = '';
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// beforeinstallprompt — глобальное событие; промпт сохраняется
// и раздаётся подписчикам (кнопка «Установить» на страницах досок).
let deferredInstallPrompt = null;
const installListeners = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installListeners.forEach((f) => f(deferredInstallPrompt));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installListeners.forEach((f) => f(null));
  });
}

export const onInstallPrompt = (cb) => {
  installListeners.add(cb);
  cb(deferredInstallPrompt); // промпт мог прийти до подписки
  return () => installListeners.delete(cb);
};
