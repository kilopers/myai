import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import SendIcon from '@mui/icons-material/Send';
import { ChatDateDivider, ChatMessage, ChatMessageGroup } from '@mui/x-chat';
import { ChatRoot } from '@mui/x-chat-headless';
import client from '../../api/client';
import { pushEndpoint } from '../../pwa';
import CameraCapture from '../CameraCapture';
import PhotoGallery from '../PhotoGallery';

const fmtSize = (b) => (b >= 1048576
  ? `${(b / 1048576).toFixed(1)} МБ`
  : `${Math.max(1, Math.round(b / 1024))} КБ`);

const stringToColor = (s) => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  let color = '#';
  for (let i = 0; i < 3; i += 1) color += `00${((hash >> (i * 8)) & 0xff).toString(16)}`.slice(-2);
  return color;
};

const avatarProps = (name) => {
  const initials = (name || '?').trim().split(/\s+/).filter(Boolean)
    .slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const bg = stringToColor(name || '?');
  const lum = 0.299 * parseInt(bg.slice(1, 3), 16)
    + 0.587 * parseInt(bg.slice(3, 5), 16)
    + 0.114 * parseInt(bg.slice(5, 7), 16);
  return {
    sx: { bgcolor: bg, color: lum > 128 ? 'rgba(0,0,0,0.87)' : '#fff', width: 36, height: 36, fontSize: 14 },
    children: initials || '?',
  };
};

// Лента read-only: отправка идёт своим multipart-запросом,
// адаптер провайдеру — заглушка, sendMessage не вызывается.
const chatAdapter = {
  sendMessage: async () => new ReadableStream({ start: (c) => c.close() }),
};

/**
 * Обсуждение задачи: чат-лента на @mui/x-chat (пузыри, аватары,
 * дата-разделители) + композер: текст, фото с камеры/устройства,
 * любой файл — отправка одним multipart-запросом.
 */
export default function TaskComments({ taskId, onCount, onError, apiBase = '/api', guestName = '' }) {
  const [comments, setComments] = useState(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]); // [{file, preview}]
  const [thumbs, setThumbs] = useState({}); // attId -> objectURL
  const [gallery, setGallery] = useState(null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(null); // {commentId, text}
  const [savingEdit, setSavingEdit] = useState(false);
  const [me, setMe] = useState(null);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`${apiBase}/board-task-comments`, {
        params: { board_task_id: taskId },
      });
      const list = data.data ?? data;
      setComments(list);
      onCount?.(list.length);
    } catch {
      onError?.('Не удалось загрузить комментарии');
    }
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (guestName) {
      setMe({ id: `guest:${guestName}`, name: guestName });
    } else {
      client.get('/api/auth/me').then(({ data }) => setMe(data)).catch(() => {});
    }
  }, [guestName]);

  // Миниатюры фото — blob'ами через Bearer
  useEffect(() => {
    (comments ?? []).flatMap((c) => c.attachments ?? [])
      .filter((a) => a.kind === 'photo' && !thumbs[a.id])
      .forEach((a) => {
        client.get(`${apiBase}/board-task-attachments/${a.id}`, { responseType: 'blob' })
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
      if (guestName) fd.append('guest_name', guestName);
      if (body) fd.append('text', body);
      // своя подписка не должна ловить пуш о собственном действии
      if (pushEndpoint()) fd.append('exclude_endpoint', pushEndpoint());
      pending.forEach((p) => fd.append('files[]', p.file));
      await client.post(`${apiBase}/board-task-comments`, fd);
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
      if (guestName) {
        await client.post(`${apiBase}/board-task-comments/${comment.id}/delete`, {
          guest_name: guestName,
        });
      } else {
        await client.delete(`${apiBase}/board-task-comments/${comment.id}`);
      }
      load();
    } catch {
      onError?.('Не удалось удалить комментарий');
    }
  };

  // Инлайн-правка своего сообщения: Enter — сохранить, Esc — отмена.
  const saveEdit = async (comment) => {
    const body = (editing?.text ?? '').trim();
    if ((!body && !(comment.attachments?.length)) || savingEdit) return;
    setSavingEdit(true);
    try {
      if (guestName) {
        await client.post(`${apiBase}/board-task-comments/${comment.id}/update`, {
          guest_name: guestName,
          text: body,
        });
      } else {
        await client.put(`${apiBase}/board-task-comments/${comment.id}`, { text: body });
      }
      setEditing(null);
      load();
    } catch {
      onError?.('Не удалось сохранить комментарий');
    } finally {
      setSavingEdit(false);
    }
  };

  const download = async (att) => {
    try {
      const { data } = await client.get(`${apiBase}/board-task-attachments/${att.id}`, { responseType: 'blob' });
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

  const own = (c) => me && (c.user_id === me.id || (guestName && c.guest_name === me.name));

  // Комментарии → сообщения чата: текст + фото + файлы + маркер своего
  const chatMessages = useMemo(() => (comments ?? []).map((c) => ({
    id: String(c.id),
    createdAt: c.created_at,
    // role 'user' даёт класс MuiChatMessage-roleUser — по нему
    // смягчаем слишком насыщенный синий пузырь своих сообщений
    role: own(c) ? 'user' : 'assistant',
    author: { id: String(c.user_id ?? ''), displayName: c.user?.name ?? c.guest_name ?? 'Пользователь' },
    parts: editing?.commentId === c.id
      // Режим правки заменяет весь пузырь на инлайн-редактор
      ? [{ type: 'data-edit', id: `edit-${c.id}`, data: c }]
      : [
        ...(c.text ? [{ type: 'text', text: c.text, editedAt: c.edited_at }] : []),
        ...(c.attachments ?? []).map((a) => a.kind === 'photo'
          ? { type: 'data-photo', id: `photo-${a.id}`, data: a }
          : { type: 'data-file', id: `file-${a.id}`, data: a }),
        ...(own(c) ? [{ type: 'data-actions', id: `act-${c.id}`, data: c }] : []),
      ],
  })), [comments, me, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const partRenderers = useMemo(() => ({
    text: ({ part }) => (
      <Box sx={{ whiteSpace: 'pre-wrap' }}>
        {part.text}
        {part.editedAt && (
          <Typography component="span" variant="caption" sx={{ opacity: 0.55, ml: 0.5 }}>
            (изменено)
          </Typography>
        )}
      </Box>
    ),
    'data-photo': ({ part, message }) => {
      const photos = message.parts
        .filter((p) => p.type === 'data-photo')
        .map((p) => p.data);
      const index = photos.findIndex((p) => p.id === part.data.id);
      const url = thumbs[part.data.id];
      if (!url) return null;
      return (
        <Box
          component="img"
          src={url}
          alt={part.data.name}
          onClick={() => {
            const gi = allPhotos.findIndex((p) => p.url === url);
            if (gi >= 0) setGallery({ index: gi });
          }}
          sx={{
            display: 'block',
            maxWidth: '65%',
            maxHeight: 200,
            borderRadius: 1,
            mt: 0.5,
            cursor: 'zoom-in',
            objectFit: 'cover',
          }}
        />
      );
    },
    'data-file': ({ part }) => (
      <Box
        onClick={() => download(part.data)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          border: 1, borderColor: 'divider', borderRadius: 1,
          px: 1, py: 0.5, mt: 0.5, cursor: 'pointer',
          bgcolor: 'background.paper',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <InsertDriveFileIcon fontSize="small" color="action" />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" display="block" noWrap sx={{ maxWidth: 200 }}>
            {part.data.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {fmtSize(part.data.size)}
          </Typography>
        </Box>
        <DownloadIcon fontSize="small" color="action" />
      </Box>
    ),
    'data-actions': ({ part }) => (
      <Box className="comment-actions">
        <Tooltip title="Изменить комментарий">
          <IconButton
            size="small"
            onClick={() => setEditing({ commentId: part.data.id, text: part.data.text ?? '' })}
            sx={{
              p: 0.25,
              color: 'text.secondary',
              bgcolor: 'background.paper',
              boxShadow: 1,
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <EditIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Удалить комментарий">
          <IconButton
            size="small"
            onClick={() => removeComment(part.data)}
            sx={{
              p: 0.25,
              color: 'error.main',
              bgcolor: 'background.paper',
              boxShadow: 1,
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <DeleteIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    ),
    'data-edit': ({ part }) => (
      <Box sx={{ minWidth: 220 }}>
        <TextField
          fullWidth
          multiline
          minRows={1}
          maxRows={4}
          size="small"
          autoFocus
          value={editing?.text ?? ''}
          onChange={(e) => setEditing((s) => (s ? { ...s, text: e.target.value } : s))}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(null);
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              saveEdit(part.data);
            }
          }}
        />
        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, justifyContent: 'flex-end' }}>
          <Button
            size="small"
            variant="contained"
            disableElevation
            disabled={savingEdit || (!(editing?.text ?? '').trim() && !(part.data.attachments?.length))}
            onClick={() => saveEdit(part.data)}
          >
            Сохранить
          </Button>
          <Button size="small" onClick={() => setEditing(null)}>
            Отмена
          </Button>
        </Box>
      </Box>
    ),
  }), [thumbs, allPhotos, editing, savingEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingPhotos = pending.filter((p) => p.file.type.startsWith('image/'));
  const pendingFiles = pending.filter((p) => !p.file.type.startsWith('image/'));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, py: 1, overflowX: 'hidden' }}>
        {!comments ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={26} />
          </Box>
        ) : comments.length === 0 ? (
          <Alert severity="info" sx={{ mb: 1 }}>
            Комментариев пока нет — напишите первым.
          </Alert>
        ) : (
          <Box sx={{
            mb: 1,
            // Свой пузырь — мягкий оттенок вместо чистого primary.main
            '& .MuiChatMessage-roleUser .MuiChatMessage-bubble': {
              bgcolor: (t) => t.alpha(t.palette.primary.main, 0.14),
              color: 'text.primary',
            },
            // Метка времени в своём пузыре — тёмная, иначе белая на бледном
            '& .MuiChatMessage-roleUser .MuiChatMessage-inlineMeta': {
              color: 'rgba(0,0,0,0.55)',
            },
            // Кнопки действий комментария (правка/удаление) — только по
            // ховеру на сообщении, в верхнем правом углу пузыря.
            '& .MuiChatMessage-bubble': { position: 'relative' },
            '& .comment-actions': {
              opacity: 0,
              transition: 'opacity .15s ease',
              position: 'absolute',
              top: -8,
              right: -8,
              zIndex: 1,
              display: 'flex',
              gap: 0.25,
            },
            '& .MuiChatMessage:hover .comment-actions': { opacity: 1 },
          }}
          >
            <ChatRoot
              adapter={chatAdapter}
              messages={chatMessages}
              currentUser={me ? { id: String(me.id), role: 'user' } : undefined}
              partRenderers={partRenderers}
            >
              {chatMessages.map((message, index) => (
                <Fragment key={message.id}>
                  <ChatDateDivider
                    messageId={message.id}
                    index={index}
                    shouldShowDivider={({ index: i, date, previousDate }) => (
                      date != null && (i === 0 || previousDate == null
                        || date.toDateString() !== previousDate.toDateString())
                    )}
                  />
                  <ChatMessageGroup messageId={message.id} index={index}>
                    <ChatMessage
                      messageId={message.id}
                      // slots.avatar ждёт компонент, не элемент —
                      // иначе React error #130
                      slots={{ avatar: () => <Avatar {...avatarProps(message.author.displayName)} /> }}
                      sx={{ px: 0 }}
                    />
                  </ChatMessageGroup>
                </Fragment>
              ))}
            </ChatRoot>
          </Box>
        )}
        <Box ref={bottomRef} />
      </Box>

      {(pendingPhotos.length > 0 || pendingFiles.length > 0) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, py: 0.75 }}>
          {pendingPhotos.map((p) => (
            <Box key={p.preview} sx={{ position: 'relative' }}>
              <Box component="img" src={p.preview} alt={p.file.name}
                sx={{ display: 'block', width: 48, height: 48, objectFit: 'cover', borderRadius: 1 }} />
              <IconButton size="small" onClick={() => unstage(p)}
                sx={{
                  position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                  bgcolor: 'background.paper', boxShadow: 1,
                  '&:hover': { bgcolor: 'background.paper' },
                }}>
                <CloseIcon sx={{ fontSize: 14 }} />
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
