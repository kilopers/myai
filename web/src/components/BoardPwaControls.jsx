import { useEffect, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import GetAppIcon from '@mui/icons-material/GetApp';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import client from '../api/client';
import {
  arrayBufferToBase64Url,
  boardSubState,
  onInstallPrompt,
  pushSupported,
  saveBoardSubState,
  savePushEndpoint,
  urlBase64ToUint8Array,
} from '../pwa';

/**
 * PWA доски: подменяет <link rel="manifest"> на манифест этой доски
 * (браузер предложит установить отдельное «приложение доски») и
 * рисует кнопки «Установить»/«Уведомления».
 *
 * manifestHref — /api/board-apps/{token}/manifest (токен share/manifest),
 * subscribeUrl — POST/DELETE подписки доски, boardKey — ключ флага
 * подписки в localStorage (board-<id> у владельца, b-<token> у гостя).
 */
export default function BoardPwaControls({ manifestHref, subscribeUrl, boardKey, pageUrl }) {
  const [installEvt, setInstallEvt] = useState(null);
  // 'unsupported' | 'denied' | 'off' | 'on' | 'busy'
  const [push, setPush] = useState('off');

  // Подмена манифеста на время страницы доски
  useEffect(() => {
    if (!manifestHref) return undefined;
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return undefined;
    const prev = link.getAttribute('href');
    link.setAttribute('href', manifestHref);
    return () => link.setAttribute('href', prev ?? '/manifest.webmanifest');
  }, [manifestHref]);

  useEffect(() => onInstallPrompt(setInstallEvt), []);

  // Текущее состояние подписки: SW-подписка есть → добиваем запись
  // на сервере (если локально не отписывались) и показываем «on».
  useEffect(() => {
    if (!pushSupported()) {
      setPush('unsupported');
      return undefined;
    }
    if (Notification.permission === 'denied') {
      setPush('denied');
      return undefined;
    }
    let cancelled = false;
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (cancelled) return;
      if (!sub) {
        setPush('off');
        return;
      }
      savePushEndpoint(sub.endpoint);
      if (boardSubState(boardKey) === 'off') {
        setPush('off');
        return;
      }
      try {
        await postSubscription(sub);
        saveBoardSubState(boardKey, 'on');
        if (!cancelled) setPush('on');
      } catch {
        if (!cancelled) setPush('off');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, subscribeUrl]);

  const postSubscription = async (sub) => {
    await client.post(subscribeUrl, {
      endpoint: sub.endpoint,
      url: pageUrl,
      keys: {
        p256dh: arrayBufferToBase64Url(sub.getKey('p256dh')),
        auth: arrayBufferToBase64Url(sub.getKey('auth')),
      },
      content_encoding: 'aes128gcm',
    });
  };

  const subscribe = async () => {
    setPush('busy');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setPush(perm === 'denied' ? 'denied' : 'off');
        return;
      }
      const { data } = await client.get('/api/push/vapid-key');
      if (!data?.key) {
        setPush('off');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.key),
      });
      await postSubscription(sub);
      savePushEndpoint(sub.endpoint);
      saveBoardSubState(boardKey, 'on');
      setPush('on');
    } catch {
      setPush('off');
    }
  };

  const unsubscribe = async () => {
    setPush('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      // SW-подписку не убиваем — она общая для всех досок; просто
      // удаляем запись этой доски на сервере.
      if (sub) {
        await client.delete(subscribeUrl, { data: { endpoint: sub.endpoint } });
      }
      saveBoardSubState(boardKey, 'off');
    } catch { /* уже отписаны */ }
    setPush('off');
  };

  if (!pushSupported() && !installEvt) return null;

  return (
    <>
      {installEvt && (
        <Tooltip title="Установить приложение доски">
          <IconButton
            size="small"
            onClick={async () => {
              installEvt.prompt();
              await installEvt.userChoice.catch(() => {});
              setInstallEvt(null);
            }}
          >
            <GetAppIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {pushSupported() && push !== 'unsupported' && (
        <Tooltip title={
          push === 'denied' ? 'Уведомления запрещены в браузере'
            : push === 'on' ? 'Отключить уведомления доски'
              : 'Включить уведомления доски'
        }
        >
          <span>
            <IconButton
              size="small"
              disabled={push === 'denied' || push === 'busy'}
              color={push === 'on' ? 'primary' : 'default'}
              onClick={push === 'on' ? unsubscribe : subscribe}
            >
              {push === 'denied'
                ? <NotificationsOffIcon fontSize="small" />
                : push === 'on'
                  ? <NotificationsIcon fontSize="small" />
                  : <NotificationsNoneIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      )}
    </>
  );
}
