import { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useParams } from 'react-router-dom';
import client from '../api/client';
import AppDialog from '../components/AppDialog';
import ShareShell from '../components/ShareShell';
import BoardCanvas from '../components/board/BoardCanvas';
import { useAuth } from '../context/AuthContext';

const NAME_KEY = 'myai:guest-name';

/** Инициалы: первые буквы первых двух слов; одно слово — одна буква. */
const initials = (name) => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
};

/**
 * Гостевая доска по share-ссылке (/b/:token): то же полотно BoardCanvas,
 * что и у владельца — колонки, задачи, drag&drop, вложения, обсуждение.
 * Имя гостя в localStorage (аватар-инициалы, клик — смена),
 * авторизованному показывает его имя.
 */
export default function PublicBoardPage() {
  const { token } = useParams();
  const { user } = useAuth();
  const [notFound, setNotFound] = useState(false);
  const [guestName, setGuestName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [nameDlg, setNameDlg] = useState(false);
  const [nameInput, setNameInput] = useState('');

  // Гость без имени — диалог «Введите свое имя» при каждом открытии.
  useEffect(() => {
    if (!user && !guestName) setNameDlg(true);
  }, [user, guestName]);

  const displayName = user?.name ?? guestName;
  const ini = initials(displayName);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await client.get(`/api/public/boards/${token}`);
      return { board: data.board, columns: data.columns };
    } catch (e) {
      setNotFound(true);
      throw e;
    }
  }, [token]);

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
    <ShareShell title="Доска" actions={nameBlock} fill>
      {notFound ? (
        <Typography color="text.secondary" sx={{ py: 6 }}>
          Доска не найдена или ссылка недействительна.
        </Typography>
      ) : (
        <BoardCanvas
          apiBase={`/api/public/boards/${token}`}
          fetchData={fetchData}
          guestName={displayName}
          height="calc(100dvh - 56px)"
          header={({ board, openColumnCreate }) => (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="h6" noWrap sx={{ flexGrow: 1, fontWeight: 600 }}>
                {board?.name ?? <CircularProgress size={16} />}
              </Typography>
              <Tooltip title="Добавить колонку">
                <Fab size="small" color="primary" onClick={openColumnCreate}>
                  <AddIcon />
                </Fab>
              </Tooltip>
            </Box>
          )}
        />
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
