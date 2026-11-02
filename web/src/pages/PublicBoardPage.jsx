import { useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import { useParams } from 'react-router-dom';
import client from '../api/client';
import AppDialog from '../components/AppDialog';
import ShareShell from '../components/ShareShell';
import { useAuth } from '../context/AuthContext';

const NAME_KEY = 'myai:guest-name';

/** Инициалы: первые буквы первых двух слов; одно слово — одна буква. */
const initials = (name) => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
};

const plainText = (html) => {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.trim() ?? '';
};

const fmtCreated = (s) => (s ? new Date(s).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '');

/**
 * Гостевой просмотр доски по share-ссылке (/b/:token): шапка без
 * меню, колонки read-only, справа — имя гостя с аватаром
 * (localStorage, правится кликом). Авторизованному показывает его имя.
 */
export default function PublicBoardPage() {
  const { token } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [guestName, setGuestName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [nameDlg, setNameDlg] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    client.get(`/api/public/boards/${token}`)
      .then((r) => setData(r.data))
      .catch(() => setError(true));
  }, [token]);

  // Гость без имени — диалог «Введите свое имя» при каждом открытии.
  useEffect(() => {
    if (!user && !guestName) setNameDlg(true);
  }, [user, guestName]);

  const displayName = user?.name ?? guestName;
  const ini = initials(displayName);

  const saveName = () => {
    const n = nameInput.trim();
    if (!n) return;
    localStorage.setItem(NAME_KEY, n);
    setGuestName(n);
    setNameDlg(false);
  };

  const nameBlock = (
    <Box
      onClick={() => {
        if (user) return;
        setNameInput(guestName);
        setNameDlg(true);
      }}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.75,
        cursor: user ? 'default' : 'pointer', ml: 1,
      }}
      title={user ? undefined : 'Изменить имя'}
    >
      <Avatar sx={{ width: 26, height: 26, fontSize: 11, bgcolor: ini ? 'primary.main' : 'action.disabled' }}>
        {ini || ''}
      </Avatar>
      <Typography variant="body2" noWrap sx={{ maxWidth: 140, color: '#fff' }}>
        {displayName || 'Введите свое имя'}
      </Typography>
    </Box>
  );

  return (
    <ShareShell
      title={data ? `Доска «${data.board.name}»` : 'Доска'}
      actions={nameBlock}
    >
      {error ? (
        <Typography color="text.secondary">Доска не найдена или ссылка недействительна.</Typography>
      ) : !data ? (
        <CircularProgress />
      ) : (
        <Box sx={{
          display: 'flex', gap: 1.5, alignItems: 'flex-start',
          overflowX: 'auto', width: '100%', maxWidth: 1400, pb: 1,
        }}
        >
          {data.columns.map((c) => (
            <Box
              key={c.id}
              sx={{
                width: { xs: 'calc(100% - 8px)', md: 300 },
                flex: '0 0 auto',
                bgcolor: 'rgba(0,0,0,0.04)',
                borderRadius: 1.5,
              }}
            >
              <Box sx={{
                bgcolor: c.color, color: '#fff', borderRadius: '6px 6px 0 0',
                px: 1, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5,
              }}
              >
                <Typography sx={{
                  fontSize: '0.82rem', fontWeight: 600, flexGrow: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                >
                  {c.name}
                </Typography>
                <Typography sx={{ fontSize: '0.72rem', opacity: 0.85 }}>
                  {c.tasks?.length ?? 0}
                </Typography>
              </Box>
              <Box sx={{ px: 0.75, pt: 0.75 }}>
                {(c.tasks ?? []).map((t) => (
                  <Box
                    key={t.id}
                    sx={{
                      position: 'relative',
                      bgcolor: 'background.paper',
                      borderRadius: 1,
                      px: 1,
                      py: 0.75,
                      mb: 0.75,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                    }}
                  >
                    {data.board.prefix && t.number != null && (
                      <Box
                        component="span"
                        sx={{
                          position: 'absolute', top: 4, right: 4,
                          px: 0.5, py: 0.1,
                          border: '1px solid', borderColor: 'primary.main',
                          borderRadius: 1, bgcolor: 'transparent',
                          color: 'primary.main', fontSize: '0.62rem',
                          fontWeight: 600, lineHeight: 1.4, letterSpacing: 0.4,
                          userSelect: 'none',
                        }}
                      >
                        {data.board.prefix}-{t.number}
                      </Box>
                    )}
                    <Typography sx={{
                      fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.3,
                      display: '-webkit-box', WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      pr: data.board.prefix && t.number != null ? 6 : 0,
                    }}
                    >
                      {t.title}
                    </Typography>
                    {t.text ? (
                      <Typography
                        color="text.secondary"
                        sx={{
                          fontSize: '0.75rem', lineHeight: 1.3, mt: 0.25,
                          display: '-webkit-box', WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {plainText(t.text)}
                      </Typography>
                    ) : null}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      {(t.attachments_count ?? 0) > 0 && (
                        <Tooltip title={`Прикреплённые файлы: ${t.attachments_count}`}>
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, color: 'text.secondary' }}>
                            <AttachFileIcon sx={{ fontSize: 13 }} />
                            <Typography component="span" sx={{ fontSize: '0.7rem' }}>{t.attachments_count}</Typography>
                          </Box>
                        </Tooltip>
                      )}
                      {(t.comments_count ?? 0) > 0 && (
                        <Tooltip title={`Сообщений в обсуждении: ${t.comments_count}`}>
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3, color: 'text.secondary' }}>
                            <ChatBubbleOutlineOutlinedIcon sx={{ fontSize: 13 }} />
                            <Typography component="span" sx={{ fontSize: '0.7rem' }}>{t.comments_count}</Typography>
                          </Box>
                        </Tooltip>
                      )}
                      <Box sx={{ flex: 1 }} />
                      <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>
                        {fmtCreated(t.created_at)}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Имя гостя — пока не введено, спрашиваем при каждом открытии */}
      <AppDialog open={nameDlg} onClose={() => guestName && setNameDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Введите свое имя</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Имя"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          {guestName && <Button onClick={() => setNameDlg(false)}>Отмена</Button>}
          <Button variant="contained" onClick={saveName} disabled={!nameInput.trim()}>
            Сохранить
          </Button>
        </DialogActions>
      </AppDialog>
    </ShareShell>
  );
}
