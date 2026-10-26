import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RestoreIcon from '@mui/icons-material/Restore';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function TrashPage() {
  const { user, setUser } = useAuth();
  const [trashDays, setTrashDays] = useState('14');
  const [trash, setTrash] = useState({ files: [], screenshots: [] });
  const [trashTab, setTrashTab] = useState(0);
  const [log, setLog] = useState([]);
  const [logLoaded, setLogLoaded] = useState(false);
  const [message, setMessage] = useState('');

  const loadTrash = useCallback(async () => {
    const { data } = await client.get('/api/trash');
    setTrash({ files: data.files ?? [], screenshots: data.screenshots ?? [] });
  }, []);

  const loadLog = useCallback(async () => {
    const { data } = await client.get('/api/trash/log');
    setLog(data.entries ?? []);
    setLogLoaded(true);
  }, []);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  useEffect(() => {
    if (trashTab === 2 && !logLoaded) {
      loadLog();
    }
  }, [trashTab, logLoaded, loadLog]);

  useEffect(() => {
    if (user) {
      setTrashDays(String(user.trash_retention_days ?? 14));
    }
  }, [user]);

  const items = trashTab === 0 ? trash.files : trash.screenshots;
  const kindLabel = { file: 'Файл', screenshot: 'Скриншот', folder: 'Папка' };

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Корзина
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Удалённые файлы и скриншоты хранятся в корзине, потом удаляются
            насовсем. На десктопе корзина не отображается.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              type="number"
              label="Хранить удалённые файлы, дней"
              value={trashDays}
              onChange={(e) => setTrashDays(e.target.value)}
              slotProps={{ htmlInput: { min: 0 } }}
              sx={{ flexGrow: 1 }}
            />
            <Button
              variant="contained"
              onClick={async () => {
                const { data } = await client.put('/api/me', {
                  trash_retention_days: trashDays === '' ? 14 : Number(trashDays),
                });
                setUser(data.data ?? data);
                setMessage('Настройка корзины сохранена');
              }}
            >
              Сохранить
            </Button>
            <Button
              variant="outlined"
              color="error"
              disabled={trash.files.length + trash.screenshots.length === 0}
              onClick={async () => {
                await client.delete('/api/trash');
                setMessage('Корзина очищена');
                loadTrash();
              }}
            >
              Очистить корзину
            </Button>
          </Box>

          <Tabs value={trashTab} onChange={(_, v) => setTrashTab(v)} sx={{ mb: 1 }}>
            <Tab label={`Файлы (${trash.files.length})`} />
            <Tab label={`Скриншоты (${trash.screenshots.length})`} />
            <Tab label="Логи" />
          </Tabs>

          {trashTab === 2 ? (
            <List dense>
              {log.map((entry) => (
                <ListItem key={entry.id}>
                  <ListItemText
                    primary={`${entry.name} — ${kindLabel[entry.kind] ?? entry.kind}`}
                    secondary={
                      `${entry.dir_path || 'корень'} · ` +
                      `${entry.size > 1048576 ? `${(entry.size / 1048576).toFixed(1)} МБ` : `${(entry.size / 1024).toFixed(1)} КБ`} · ` +
                      `удалено ${new Date(entry.deleted_at).toLocaleString()}`
                    }
                  />
                </ListItem>
              ))}
              {log.length === 0 && (
                <Typography variant="body2" color="text.secondary">Журнал пуст.</Typography>
              )}
            </List>
          ) : (
          <List dense>
            {items.map((item) => (
              <ListItem
                key={item.id}
                secondaryAction={
                  <Box>
                    <Tooltip title="Восстановить">
                      <IconButton
                        onClick={async () => {
                          await client.post(`/api/trash/${trashTab === 0 ? 'file' : 'screenshot'}/${item.id}/restore`);
                          setMessage(`«${item.name}» восстановлено`);
                          loadTrash();
                        }}
                      >
                        <RestoreIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Удалить навсегда">
                      <IconButton
                        color="error"
                        onClick={async () => {
                          await client.delete(`/api/trash/${trashTab === 0 ? 'file' : 'screenshot'}/${item.id}`);
                          loadTrash();
                        }}
                      >
                        <DeleteForeverIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                }
              >
                <ListItemText
                  primary={item.name}
                  secondary={
                    `${item.original_path ?? ''} · ` +
                    `${item.size > 1048576 ? `${(item.size / 1048576).toFixed(1)} МБ` : `${(item.size / 1024).toFixed(1)} КБ`} · ` +
                    `в корзине с ${new Date(item.deleted_at).toLocaleString()}`
                  }
                />
              </ListItem>
            ))}
            {items.length === 0 && (
              <Typography variant="body2" color="text.secondary">Корзина пуста.</Typography>
            )}
          </List>
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={!!message}
        autoHideDuration={3000}
        onClose={() => setMessage('')}
        message={message}
      />
    </Box>
  );
}
