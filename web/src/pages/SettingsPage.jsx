import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RestoreIcon from '@mui/icons-material/Restore';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const [tokens, setTokens] = useState([]);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState(null);
  const [passwords, setPasswords] = useState({ current_password: '', password: '', password_confirmation: '' });
  const [profile, setProfile] = useState({ name: '', email: '' });
  const [ttls, setTtls] = useState({ screenshot: '', file: '', link: '' });
  const [trashDays, setTrashDays] = useState('14');
  const [trash, setTrash] = useState({ files: [], screenshots: [] });
  const [trashTab, setTrashTab] = useState(0);
  const [rootHash, setRootHash] = useState('');
  const [message, setMessage] = useState('');

  const loadTokens = useCallback(async () => {
    const { data } = await client.get('/api/tokens');
    setTokens(data);
  }, []);

  const loadTrash = useCallback(async () => {
    const { data } = await client.get('/api/trash');
    setTrash({ files: data.files ?? [], screenshots: data.screenshots ?? [] });
    try {
      const r = await client.post('/api/sync/hash', {});
      setRootHash(r.data.root_hash ?? '');
    } catch { /* sync недоступен */ }
  }, []);

  useEffect(() => {
    loadTokens();
    loadTrash();
    if (user) {
      setProfile({ name: user.name, email: user.email });
      setTtls({
        screenshot: user.default_screenshot_ttl_days ?? '',
        file: user.default_file_ttl_days ?? '',
        link: user.default_link_ttl_days ?? '',
      });
      setTrashDays(String(user.trash_retention_days ?? 14));
    }
  }, [loadTokens, loadTrash, user]);

  const createToken = async () => {
    if (!tokenName.trim()) return;
    const { data } = await client.post('/api/tokens', { name: tokenName });
    setNewToken(data.token);
    setTokenName('');
    loadTokens();
  };

  const revokeToken = async (id) => {
    await client.delete(`/api/tokens/${id}`);
    loadTokens();
  };

  const changePassword = async (e) => {
    e.preventDefault();
    await client.post('/api/auth/change-password', passwords);
    setPasswords({ current_password: '', password: '', password_confirmation: '' });
    setUser({ ...user, must_change_password: false });
    setMessage('Пароль изменён');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 640 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            API-токены для приложения
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Создай токен и вставь его в настройки десктоп-приложения.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              label="Имя токена (напр. «рабочий ПК»)"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              fullWidth
            />
            <Button variant="contained" onClick={createToken}>
              Создать
            </Button>
          </Box>
          {newToken && (
            <Alert severity="success" sx={{ mb: 2, wordBreak: 'break-all' }} action={
              <IconButton size="small" onClick={() => navigator.clipboard.writeText(newToken)}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            }>
              {newToken}
            </Alert>
          )}
          <List dense>
            {tokens.map((t) => (
              <ListItem
                key={t.id}
                secondaryAction={
                  <IconButton edge="end" onClick={() => revokeToken(t.id)}>
                    <DeleteIcon />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={t.name}
                  secondary={`Создан ${new Date(t.created_at).toLocaleDateString()}` +
                    (t.last_used_at ? ` · использовался ${new Date(t.last_used_at).toLocaleDateString()}` : '')}
                />
              </ListItem>
            ))}
            {tokens.length === 0 && (
              <Typography variant="body2" color="text.secondary">Токенов пока нет.</Typography>
            )}
          </List>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Профиль
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              size="small"
              label="Имя"
              value={profile.name}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
            />
            <TextField
              size="small"
              type="email"
              label="Email"
              value={profile.email}
              onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
            />
            <Button
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              onClick={async () => {
                const { data } = await client.put('/api/me', profile);
                setUser(data.data ?? data);
                setMessage('Профиль сохранён');
              }}
            >
              Сохранить профиль
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Сроки хранения по умолчанию
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            В днях. Пусто или 0 — хранить вечно. На файл можно задать свой срок.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              size="small"
              type="number"
              label="Срок жизни скриншотов (дней)"
              value={ttls.screenshot}
              onChange={(e) => setTtls((t) => ({ ...t, screenshot: e.target.value }))}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            <TextField
              size="small"
              type="number"
              label="Срок жизни файлов (дней)"
              value={ttls.file}
              onChange={(e) => setTtls((t) => ({ ...t, file: e.target.value }))}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            <TextField
              size="small"
              type="number"
              label="Срок жизни ссылок на файлы (дней)"
              value={ttls.link}
              onChange={(e) => setTtls((t) => ({ ...t, link: e.target.value }))}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            <Button
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              onClick={async () => {
                const { data } = await client.put('/api/me', {
                  default_screenshot_ttl_days: ttls.screenshot === '' ? null : Number(ttls.screenshot),
                  default_file_ttl_days: ttls.file === '' ? null : Number(ttls.file),
                  default_link_ttl_days: ttls.link === '' ? null : Number(ttls.link),
                });
                setUser(data.data ?? data);
                setMessage('Сроки сохранены');
              }}
            >
              Сохранить сроки
            </Button>
          </Box>
        </CardContent>
      </Card>

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
          </Tabs>

          <List dense>
            {(trashTab === 0 ? trash.files : trash.screenshots).map((item) => (
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
            {(trashTab === 0 ? trash.files : trash.screenshots).length === 0 && (
              <Typography variant="body2" color="text.secondary">Корзина пуста.</Typography>
            )}
          </List>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Синхронизация
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Хэш корневой папки (сверяйте с настройками десктопа — при
            расхождении деревья разошлись, нужна синхронизация):
          </Typography>
          <Typography
            variant="body2"
            component="div"
            sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
          >
            {rootHash || '—'}
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Смена пароля
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Box component="form" onSubmit={changePassword} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              size="small"
              type="password"
              label="Текущий пароль"
              value={passwords.current_password}
              onChange={(e) => setPasswords((p) => ({ ...p, current_password: e.target.value }))}
              required
            />
            <TextField
              size="small"
              type="password"
              label="Новый пароль"
              value={passwords.password}
              onChange={(e) => setPasswords((p) => ({ ...p, password: e.target.value }))}
              required
            />
            <TextField
              size="small"
              type="password"
              label="Новый пароль ещё раз"
              value={passwords.password_confirmation}
              onChange={(e) => setPasswords((p) => ({ ...p, password_confirmation: e.target.value }))}
              required
            />
            <Button type="submit" variant="contained" sx={{ alignSelf: 'flex-start' }}>
              Сменить пароль
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Snackbar open={!!message} autoHideDuration={3000} onClose={() => setMessage('')} message={message} />
    </Box>
  );
}
