import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import client from '../api/client';

export const isOfficeMime = (mime) =>
  mime === 'application/msword' ||
  mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Режим встроенного просмотрщика по типу файла:
 * image — лайтбокс; pages — постраничный просмотр (pdf/word после
 * конвертации); video — HTML5-плеер; null — только оригинал.
 */
export function viewMode(f) {
  const mime = f.mime_type || '';
  if (mime.startsWith('image/')) return 'image';
  if (f.conversion_status === 'done') {
    if (mime === 'application/pdf' || isOfficeMime(mime)) return 'pages';
    if (mime.startsWith('video/')) return 'video';
  }
  return null;
}

const blobUrl = async (url) => {
  const { data } = await client.get(url, { responseType: 'blob' });
  return URL.createObjectURL(data);
};

/**
 * Встроенный просмотрщик файла. Данные приватные: картинки и страницы
 * грузим blob'ами через axios (Bearer), видео и скачивание оригинала —
 * подписанными ссылками /media-url (стриминг по HTTP Range, без копии
 * файла в память вкладки).
 */
export default function FileViewerDialog({ file, onClose }) {
  const mode = file ? viewMode(file) : null;
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [posterUrl, setPosterUrl] = useState(null);
  const [error, setError] = useState(false);
  const pageCache = useRef(new Map());
  const pendingSeek = useRef(0); // секунды, куда перемотать видео после загрузки метаданных
  const lastSaveAt = useRef(0);  // ms — троттлинг автосейва позиции
  const lastPos = useRef(null);  // последняя позиция для досейва при закрытии
  const fileRef = useRef(file);
  fileRef.current = file;

  // Сброс состояния при смене файла
  useEffect(() => {
    setPage(1);
    setCount(0);
    setMediaUrl(null);
    setPosterUrl(null);
    setError(false);
    pageCache.current.forEach((u) => URL.revokeObjectURL(u));
    pageCache.current = new Map();
    pendingSeek.current = 0;
    lastSaveAt.current = 0;
    lastPos.current = null;
  }, [file?.id]);

  // Сохранение позиции просмотра (pages — page, video — seconds)
  const savePosition = useCallback((position) => {
    if (!file) return;
    client.put(`/api/files/${file.id}/position`, { position }).catch(() => {});
  }, [file]);

  // Восстановление позиции: страница pdf/word или секунда видео
  useEffect(() => {
    if (!file || (mode !== 'pages' && mode !== 'video')) return undefined;
    let cancelled = false;
    client.get(`/api/files/${file.id}/position`)
      .then(({ data }) => {
        const pos = data?.position;
        if (cancelled || !pos) return;
        if (mode === 'pages' && pos.page > 0) setPage(pos.page);
        if (mode === 'video' && pos.seconds > 0) pendingSeek.current = pos.seconds;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [file?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Автосейв текущей страницы (дебаунс — при быстром листании не спамим PUT'ами)
  useEffect(() => {
    if (mode !== 'pages' || !file || count === 0) return undefined;
    const t = setTimeout(() => {
      lastPos.current = { page };
      savePosition({ page });
    }, 400);
    return () => clearTimeout(t);
  }, [mode, file, page, count, savePosition]);

  // Обработчики <video>: seek из сохранённой позиции + автосейв раз в 10 с,
  // на паузе и по окончании (конец → сброс на начало)
  const videoEvents = {
    onLoadedMetadata: (e) => {
      const { duration } = e.currentTarget;
      if (pendingSeek.current > 0 && pendingSeek.current < duration - 1) {
        e.currentTarget.currentTime = pendingSeek.current;
      }
      pendingSeek.current = 0;
    },
    onTimeUpdate: (e) => {
      const seconds = Math.floor(e.currentTarget.currentTime);
      lastPos.current = { seconds };
      const now = Date.now();
      if (now - lastSaveAt.current >= 10000) {
        lastSaveAt.current = now;
        savePosition({ seconds });
      }
    },
    onPause: (e) => {
      lastSaveAt.current = Date.now();
      const seconds = Math.floor(e.currentTarget.currentTime);
      lastPos.current = { seconds };
      savePosition({ seconds });
    },
    onEnded: () => {
      lastSaveAt.current = Date.now();
      lastPos.current = { seconds: 0 };
      savePosition({ seconds: 0 });
    },
  };

  const handleClose = useCallback(() => {
    if (lastPos.current) savePosition(lastPos.current);
    onClose();
  }, [onClose, savePosition]);

  // Загрузка контента по режиму
  useEffect(() => {
    if (!file || !mode) return undefined;
    let obj = null;
    let cancelled = false;
    if (mode === 'image') {
      blobUrl(`/api/files/${file.id}/download`)
        .then((u) => { obj = u; if (!cancelled) setMediaUrl(u); })
        .catch(() => setError(true));
    } else if (mode === 'pages') {
      client.get(`/api/files/${file.id}/pages`)
        .then(({ data }) => setCount(data.count ?? 0))
        .catch(() => setError(true));
    } else if (mode === 'video') {
      // Видео стримим по подписанной ссылке (HTTP Range) — иначе axios
      // тянул бы весь файл в Blob до начала воспроизведения.
      client.get(`/api/files/${file.id}/media-url`)
        .then(({ data }) => { if (!cancelled) setMediaUrl(data.stream); })
        .catch(() => setError(true));
      blobUrl(`/api/files/${file.id}/thumbnail`)
        .then((u) => { if (!cancelled) setPosterUrl(u); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [file?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ленивая загрузка текущей страницы (кэш blob'ов по номеру)
  useEffect(() => {
    if (mode !== 'pages' || !file || count === 0) return undefined;
    let cancelled = false;
    const cached = pageCache.current.get(page);
    if (cached) {
      setMediaUrl(cached);
      return undefined;
    }
    blobUrl(`/api/files/${file.id}/pages/${page}`)
      .then((u) => {
        pageCache.current.set(page, u);
        if (!cancelled) setMediaUrl(u);
      })
      .catch(() => setError(true));
    return () => { cancelled = true; };
  }, [mode, file, page, count]);

  // Префетч следующей страницы — листание без задержки
  useEffect(() => {
    if (mode !== 'pages' || !file || page >= count) return;
    const next = page + 1;
    if (!pageCache.current.has(next)) {
      blobUrl(`/api/files/${file.id}/pages/${next}`)
        .then((u) => pageCache.current.set(next, u))
        .catch(() => {});
    }
  }, [mode, file, page, count]);

  const prevPage = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const nextPage = useCallback(() => setPage((p) => Math.min(count, p + 1)), [count]);

  // Стрелки клавиатуры для постраничного режима
  useEffect(() => {
    if (mode !== 'pages') return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') prevPage();
      if (e.key === 'ArrowRight') nextPage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, prevPage, nextPage]);

  // Освобождение blob-ссылок при размонтировании диалога
  useEffect(() => () => {
    pageCache.current.forEach((u) => URL.revokeObjectURL(u));
    // Досейв позиции — если диалог умер без handleClose
    if (lastPos.current && fileRef.current) {
      client.put(`/api/files/${fileRef.current.id}/position`, { position: lastPos.current })
        .catch(() => {});
    }
  }, []);

  const downloadOriginal = async () => {
    // Подписанная ссылка — браузер качает напрямую, без Blob в памяти
    // (для больших файлов blob-скачивание съедало гигабайты RAM).
    const { data } = await client.get(`/api/files/${file.id}/media-url`);
    const a = document.createElement('a');
    a.href = data.download;
    a.download = file.name;
    a.click();
  };

  if (!file) return null;

  return (
    <Dialog open onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
          {file.name}
          {mode === 'pages' && count > 0 && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              стр. {page} из {count}
            </Typography>
          )}
        </Typography>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 320,
          bgcolor: 'action.hover',
        }}
      >
        {error ? (
          <Typography color="text.secondary">Не удалось загрузить файл — скачайте оригинал.</Typography>
        ) : mode === 'video' ? (
          mediaUrl ? (
            <Box
              component="video"
              src={mediaUrl}
              poster={posterUrl ?? undefined}
              controls
              autoPlay
              {...videoEvents}
              sx={{ maxWidth: '100%', maxHeight: '70vh', bgcolor: 'black' }}
            />
          ) : (
            <CircularProgress />
          )
        ) : mediaUrl ? (
          <Box
            component="img"
            src={mediaUrl}
            alt={file.name}
            sx={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <CircularProgress />
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Box>
          {mode === 'pages' && count > 0 && (
            <>
              <IconButton onClick={prevPage} disabled={page <= 1}>
                <ChevronLeftIcon />
              </IconButton>
              <IconButton onClick={nextPage} disabled={page >= count}>
                <ChevronRightIcon />
              </IconButton>
            </>
          )}
        </Box>
        <Button startIcon={<DownloadIcon />} onClick={downloadOriginal}>
          Скачать оригинал
        </Button>
      </DialogActions>
    </Dialog>
  );
}
