import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import SendIcon from '@mui/icons-material/Send';
import client from '../../api/client';
import CameraCapture from '../CameraCapture';
import PhotoGallery from '../PhotoGallery';

const fmtSize = (b) => (b >= 1048576
  ? `${(b / 1048576).toFixed(1)} МБ`
  : `${Math.max(1, Math.round(b / 1024))} КБ`);

const fmtTime = (iso) => new Date(iso).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/**
 * Обсуждение задачи: лента комментариев (автор, время, текст,
 * фото-превью и файлы) + композер: текст, фото с камеры/устройства,
 * любой файл — отправляется одним multipart-запросом.
 */
export default function TaskComments({ taskId, onCount, onError }) {
  const [comments, setComments] = useState(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]); // [{file, preview}]
  const [thumbs, setThumbs] = useState({}); // attId -> objectURL
  const [gallery, setGallery] = useState(null);
  const [sending, setSending] = useState(false);
  const [me, setMe] = useState(null);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/api/board-task-comments', {
        params: { board_task_id: taskId },
      });
      setComments(data.data ?? data);
      onCount?.((data.data ?? data).length);
    } catch {
      onError?.('Не удалось загрузить комментарии');
    }
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    client.get('/api/auth/me').then(({ data }) => setMe(data)).catch(() => {});
  }, []);

  // Миниатюры фото — blob'ами через Bearer
  useEffect(() => {
    (comments ?? []).flatMap((c) => c.attachments ?? [])
      .filter((a) => a.kind === 'photo' && !thumbs[a.id])
      .forEach((a) => {
        client.get(`/api/board-task-attachments/${a.id}`, { responseType: 'blob' })
          .then(({ data }) => setThumbs((t) => ({ ...t, [a.id]: URL.createObjectURL(data) })))
          .catch(() => {});
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments]);

  useEffect(() => () => {
    Object.values(thumbs).forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [comments?.length]);

  const stage = (file) => {
    setPending((p) => [...p, { file, preview: URL.createObjectURL(file) }]);
    return true;
  };

  const unstage = (item) => {
    URL.revokeObjectURL(item.preview);
    setPending((p) => p.filter((x) => x !== item));
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && pending.length === 0) || sending) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('board_task_id', taskId);
      if (body) fd.append('text', body);
      pending.forEach((p) => fd.append('files[]', p.file));
      await client.post('/api/board-task-comments', fd);
      pending.forEach((p) => URL.revokeObjectURL(p.preview));
      setPending([]);
      setText('');
      load();
    } catch {
      onError?.('Не удалось отправить комментарий');
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (comment) => {
    try {
      await client.delete(`/api/board-task-comments/${comment.id}`);
      load();
    } catch {
      onError?.('Не удалось удалить комментарий');
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

  const allPhotos = (comments ?? [])
    .flatMap((c) => c.attachments ?? [])
    .filter((a) => a.kind === 'photo' && thumbs[a.id])
    .map((a) => ({ url: thumbs[a.id], name: a.name }));

  const openGallery = (att) => {
    const idx = allPhotos.findIndex((p) => p.url === thumbs[att.id]);
    if (idx >= 0) setGallery({ index: idx });
  };

  const pendingPhotos = pending.filter((p) => p.file.type.startsWith('image/'));
  const pendingFiles = pending.filter((p) => !p.file.type.startsWith('image/'));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 300 }}>
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, py: 1 }}>
        {!comments ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={26} />
          </Box>
        ) : comments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            Комментариев пока нет — напишите первым.
          </Typography>
        ) : (
          comments.map((c) => (
            <Box
              key={c.id}
              sx={{
                mb: 1, mx: { xs: 0, sm: 1 },
                border: 1, borderColor: 'divider', borderRadius: 2,
                px: 1.5, py: 1, bgcolor: 'background.paper',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {c.user?.name ?? 'Пользователь'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {fmtTime(c.created_at)}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {me && c.user_id === me.id && (
                  <IconButton size="small" onClick={() => removeComment(c)}>
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Box>
              {c.text && (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.25 }}>
                  {c.text}
                </Typography>
              )}
              {(c.attachments ?? []).length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.75 }}>
                  {c.attachments.map((a) => a.kind === 'photo' ? (
                    thumbs[a.id] && (
                      <Box
                        key={a.id}
                        component="img"
                        src={thumbs[a.id]}
                        alt={a.name}
                        onClick={() => openGallery(a)}
                        sx={{
                          width: 56, height: 56, objectFit: 'cover',
                          borderRadius: 1, cursor: 'pointer',
                          border: 1, borderColor: 'divider',
                        }}
                      />
                    )
                  ) : (
                    <Box
                      key={a.id}
                      onClick={() => download(a)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 0.75,
                        border: 1, borderColor: 'divider', borderRadius: 1,
                        px: 1, py: 0.5, cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <InsertDriveFileIcon fontSize="small" color="action" />
                      <Box>
                        <Typography variant="caption" display="block" noWrap sx={{ maxWidth: 180 }}>
                          {a.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {fmtSize(a.size)}
                        </Typography>
                      </Box>
                      <DownloadIcon fontSize="small" color="action" />
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          ))
        )}
        <Box ref={bottomRef} />
      </Box>

      {(pendingPhotos.length > 0 || pendingFiles.length > 0) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, py: 0.75 }}>
          {pendingPhotos.map((p) => (
            <Box key={p.preview} sx={{ position: 'relative' }}>
              <Box component="img" src={p.preview} alt={p.file.name}
                sx={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 1 }} />
              <IconButton size="small" onClick={() => unstage(p)}
                sx={{
                  position: 'absolute', top: -6, right: -6, p: 0.25,
                  bgcolor: 'background.paper', boxShadow: 1,
                }}>
                <CloseIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </Box>
          ))}
          {pendingFiles.map((p) => (
            <Box key={p.file.name + p.file.size} sx={{
              display: 'flex', alignItems: 'center', gap: 0.5,
              border: 1, borderColor: 'divider', borderRadius: 1, px: 1,
            }}>
              <InsertDriveFileIcon fontSize="small" color="action" />
              <Typography variant="caption" noWrap sx={{ maxWidth: 140 }}>{p.file.name}</Typography>
              <IconButton size="small" onClick={() => unstage(p)}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, pt: 0.5 }}>
        <CameraCapture onCapture={stage} size="small" />
        <Tooltip title="Прикрепить файл">
          <IconButton size="small" color="primary" onClick={() => fileInputRef.current?.click()}>
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
            picked.forEach(stage);
          }}
        />
        <TextField
          fullWidth
          multiline
          maxRows={4}
          size="small"
          placeholder="Комментарий…"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <IconButton color="primary" onClick={send}
          disabled={sending || (!text.trim() && pending.length === 0)}>
          {sending ? <CircularProgress size={20} /> : <SendIcon />}
        </IconButton>
      </Box>

      <PhotoGallery
        photos={allPhotos}
        index={gallery?.index ?? null}
        onClose={() => setGallery(null)}
      />
    </Box>
  );
}
