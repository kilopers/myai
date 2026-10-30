import { useEffect, useState } from 'react';
import { Box, CircularProgress, IconButton, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import client from '../api/client';
import { isOfficeMime, viewMode } from './FileViewerDialog';

/**
 * Просмотр файла по публичной ссылке. Все данные доступны без
 * авторизации — контент грузится прямыми URL (/api/share/...),
 * без blob-скачивания через axios.
 */
export default function ShareFileView({ token, file }) {
  const mode = file ? viewMode(file) : null;
  const base = `/api/share/${token}/file/${file?.uuid}`;
  const mime = file?.mime_type || '';
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [videoSrc, setVideoSrc] = useState(null);

  // pdf/office с конвертацией — постраничный просмотр; pdf без неё —
  // встроенный просмотрщик браузера (iframe на сырой файл).
  const showIframePdf = mime === 'application/pdf' && mode !== 'pages';
  const showRawVideo = mime.startsWith('video/') && mode !== 'video';

  useEffect(() => {
    if (mode !== 'pages') return;
    setPage(1);
    client.get(`${base}/pages`)
      .then(({ data }) => setCount(data.count ?? 0))
      .catch(() => setCount(0));
  }, [mode, base]);

  // Видео: сначала пробуем конвертированную версию, при 404 — оригинал.
  useEffect(() => {
    if (mode !== 'video') return;
    setVideoSrc(`${base}/converted`);
  }, [mode, base]);

  useEffect(() => {
    if (mode !== 'pages' || count === 0) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(1, p - 1));
      if (e.key === 'ArrowRight') setPage((p) => Math.min(count, p + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, count]);

  if (mode === 'image') {
    return (
      <Box
        component="img"
        src={`${base}/raw`}
        alt={file.name}
        sx={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain', display: 'block' }}
      />
    );
  }

  if (mode === 'pages') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        {count === 0 ? (
          <CircularProgress />
        ) : (
          <Box
            component="img"
            src={`${base}/pages/${page}`}
            alt={`${file.name} — стр. ${page}`}
            sx={{ maxWidth: '100%', maxHeight: '76vh', objectFit: 'contain', display: 'block' }}
          />
        )}
        {count > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="body2" color="text.secondary">
              стр. {page} из {count}
            </Typography>
            <IconButton onClick={() => setPage((p) => Math.min(count, p + 1))} disabled={page >= count}>
              <ChevronRightIcon />
            </IconButton>
          </Box>
        )}
      </Box>
    );
  }

  if (mode === 'video' || showRawVideo) {
    return (
      <Box
        component="video"
        src={videoSrc ?? `${base}/raw`}
        controls
        autoPlay
        onError={() => setVideoSrc(`${base}/raw`)}
        sx={{ maxWidth: '100%', maxHeight: '82vh', bgcolor: 'black' }}
      />
    );
  }

  if (showIframePdf) {
    return (
      <Box
        component="iframe"
        src={`${base}/raw`}
        title={file.name}
        sx={{ width: 'min(96vw, 1100px)', height: '82vh', border: 0, borderRadius: 1 }}
      />
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
      <InsertDriveFileIcon sx={{ fontSize: 72 }} />
      <Typography>Предпросмотр для этого типа недоступен</Typography>
    </Box>
  );
}
