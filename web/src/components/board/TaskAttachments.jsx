import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import client from '../../api/client';
import CameraCapture from '../CameraCapture';
import PhotoGallery from '../PhotoGallery';

const fmtSize = (b) => (b >= 1048576
  ? `${(b / 1048576).toFixed(1)} МБ`
  : `${Math.max(1, Math.round(b / 1024))} КБ`);

/**
 * Вложения задачи доски: иконки «фото» (камера/галерея устройства)
 * и «файл» (любой тип), лента превью фото и список файлов.
 * Сохранённая задача (taskId) — мгновенная загрузка на API;
 * новая — файлы копятся в pending и уезжают после сохранения.
 */
export default function TaskAttachments({
  taskId,
  attachments = [],
  pending = [],
  onPending,
  onChanged,
  onError,
}) {
  const fileInputRef = useRef(null);
  const [thumbs, setThumbs] = useState({}); // attId -> objectURL
  const [gallery, setGallery] = useState(null); // {photos, index}

  // Миниатюры фото грузим blob'ами (Bearer) → objectURL
  useEffect(() => {
    const photos = attachments.filter((a) => a.kind === 'photo');
    photos.forEach((a) => {
      if (thumbs[a.id]) return;
      client.get(`/api/board-task-attachments/${a.id}`, { responseType: 'blob' })
        .then(({ data }) => setThumbs((t) => ({ ...t, [a.id]: URL.createObjectURL(data) })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

  useEffect(() => () => {
    Object.values(thumbs).forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFile = async (file) => {
    if (!taskId) {
      onPending([...pending, { file, preview: URL.createObjectURL(file) }]);
      return true;
    }
    try {
      const fd = new FormData();
      fd.append('board_task_id', taskId);
      fd.append('file', file);
      await client.post('/api/board-task-attachments', fd);
      onChanged();
      return true;
    } catch {
      onError?.('Не удалось загрузить вложение');
      return false;
    }
  };

  const remove = async (att) => {
    try {
      await client.delete(`/api/board-task-attachments/${att.id}`);
      onChanged();
    } catch {
      onError?.('Не удалось удалить вложение');
    }
  };

  const download = async (att) => {
    try {
      const { data } = await client.get(`/api/board-task-attachments/${att.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      onError?.('Не удалось скачать файл');
    }
  };

  const photos = attachments.filter((a) => a.kind === 'photo');
  const files = attachments.filter((a) => a.kind !== 'photo');
  const pendingPhotos = pending.filter((p) => p.file.type.startsWith('image/'));

  const galleryPhotos = [
    ...photos.map((a) => ({ url: thumbs[a.id], name: a.name })).filter((p) => p.url),
    ...pendingPhotos.map((p) => ({ url: p.preview, name: p.file.name })),
  ];

  const thumbSx = {
    position: 'relative',
    width: 64,
    height: 64,
    borderRadius: 1,
    overflow: 'hidden',
    flexShrink: 0,
    cursor: 'pointer',
    border: 1,
    borderColor: 'divider',
  };
  const delBtnSx = {
    position: 'absolute',
    top: 0,
    right: 0,
    p: 0.25,
    color: '#fff',
    bgcolor: 'rgba(0,0,0,0.5)',
    borderRadius: 0,
    '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <CameraCapture onCapture={addFile} />
        <Tooltip title="Прикрепить файл">
          <IconButton color="primary" onClick={() => fileInputRef.current?.click()}>
            <AttachFileIcon />
          </IconButton>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = '';
            picked.forEach(addFile);
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {attachments.length + pending.length > 0
            ? `Вложений: ${attachments.length + pending.length}`
            : 'Фото с камеры или файлы с диска'}
        </Typography>
      </Box>

      {(photos.length > 0 || pendingPhotos.length > 0) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
          {photos.map((a, i) => thumbs[a.id] && (
            <Box key={a.id} sx={thumbSx} onClick={() => setGallery({ index: i })}>
              <Box component="img" src={thumbs[a.id]} alt={a.name}
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <IconButton size="small" sx={delBtnSx}
                onClick={(e) => { e.stopPropagation(); remove(a); }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
          {pendingPhotos.map((p, i) => (
            <Box key={`p-${i}`} sx={{ ...thumbSx, opacity: 0.8 }}
              onClick={() => setGallery({ index: photos.length + i })}>
              <Box component="img" src={p.preview} alt={p.file.name}
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <IconButton size="small" sx={delBtnSx}
                onClick={(e) => {
                  e.stopPropagation();
                  URL.revokeObjectURL(p.preview);
                  onPending(pending.filter((x) => x !== p));
                }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {(files.length > 0 || pending.some((p) => !p.file.type.startsWith('image/'))) && (
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {files.map((a) => (
            <Box key={a.id} sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              border: 1, borderColor: 'divider', borderRadius: 1,
              px: 1, py: 0.5,
            }}>
              <InsertDriveFileIcon fontSize="small" color="action" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>{a.name}</Typography>
                <Typography variant="caption" color="text.secondary">{fmtSize(a.size)}</Typography>
              </Box>
              <IconButton size="small" onClick={() => download(a)}>
                <DownloadIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => remove(a)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          {pending.filter((p) => !p.file.type.startsWith('image/')).map((p) => (
            <Box key={`pf-${p.file.name}`} sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              border: 1, borderColor: 'divider', borderRadius: 1,
              px: 1, py: 0.5, opacity: 0.8,
            }}>
              <InsertDriveFileIcon fontSize="small" color="action" />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>{p.file.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {fmtSize(p.file.size)} · отправится после сохранения
                </Typography>
              </Box>
              <IconButton size="small" color="error"
                onClick={() => onPending(pending.filter((x) => x !== p))}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      <PhotoGallery
        photos={galleryPhotos}
        index={gallery?.index ?? null}
        onClose={() => setGallery(null)}
      />
    </Box>
  );
}
