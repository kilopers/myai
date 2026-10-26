// WebSocket-клиент Reverb по pusher-протоколу без зависимостей
// (тот же хендшейк, что в desktop/src/main.ts):
//   wss://<host>/app/<key>?protocol=7 → pusher:subscribe на sync.user.<id>.
// Статус соединения: connecting | connected | disconnected — показывается
// точкой в шапке. Реконнект с backoff; после него шлётся внутреннее
// событие 'ws.connected' — страницы пересылают dir.watch и ловят
// пропущенные изменения.
import client from './client';

let ws = null;
let status = 'disconnected';
let userId = null;
let stopped = true;
let attempts = 0;

const statusListeners = new Set();
const eventListeners = new Map();

const emit = (name, data) => {
  eventListeners.get(name)?.forEach((fn) => fn(data));
};

const setStatus = (next) => {
  if (next === status) return;
  status = next;
  statusListeners.forEach((fn) => fn(next));
};

/** Подписка на статус соединения; fn вызывается сразу с текущим. */
export const onWsStatus = (fn) => {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
};

/** Подписка на broadcast-событие канала (напр. 'dirs.changed'). */
export const onWsEvent = (name, fn) => {
  if (!eventListeners.has(name)) eventListeners.set(name, new Set());
  eventListeners.get(name).add(fn);
  return () => eventListeners.get(name)?.delete(fn);
};

const subscribe = (socket, channel) => {
  socket.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel } }));
};

const handleMessage = (socket, e) => {
  let v;
  try {
    v = JSON.parse(e.data);
  } catch {
    return;
  }
  switch (v.event) {
    case 'pusher:connection_established':
      attempts = 0;
      setStatus('connected');
      if (userId !== null) subscribe(socket, `sync.user.${userId}`);
      emit('ws.connected', {});
      break;
    case 'pusher:ping':
      socket.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      break;
    default: {
      if (!v.event || v.event.startsWith('pusher')) break;
      let data = v.data;
      // data в протоколе pusher — JSON-строка
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch { /* оставляем строкой */ }
      }
      emit(v.event, data);
    }
  }
};

const scheduleReconnect = () => {
  if (stopped) return;
  attempts += 1;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts - 1, 5));
  setTimeout(open, delay);
};

async function open() {
  if (stopped || ws) return;
  setStatus('connecting');

  let key = 'myai';
  try {
    const { data } = await client.get('/api/ws-config');
    if (data?.key) key = data.key;
  } catch {
    /* сокет всё равно пробуем — ключ может быть дефолтным */
  }
  if (stopped) return;

  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(
    `${scheme}://${window.location.host}/app/${key}?protocol=7&client=web&version=1.0`,
  );
  ws = socket;
  socket.onmessage = (e) => handleMessage(socket, e);
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    setStatus('disconnected');
    scheduleReconnect();
  };
  socket.onerror = () => socket.close();
}

/** Запуск соединения для залогиненного пользователя. */
export const wsConnect = (uid) => {
  if (userId === uid && !stopped) return;
  userId = uid;
  stopped = false;
  // Если сокет уже открыт под другим юзером — переподписываемся.
  if (ws && ws.readyState === WebSocket.OPEN) {
    subscribe(ws, `sync.user.${uid}`);
    return;
  }
  open();
};

/** Полная остановка (logout): без реконнекта. */
export const wsDisconnect = () => {
  stopped = true;
  userId = null;
  attempts = 0;
  if (ws) {
    const socket = ws;
    ws = null;
    socket.onclose = null;
    socket.close();
  }
  setStatus('disconnected');
};
