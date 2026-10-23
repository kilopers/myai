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
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
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
  const [message, setMessage] = useState('');

  const loadTokens = useCallback(async () => {
    const { data } = await client.get('/api/tokens');
    setTokens(data);
  }, []);

  useEffect(() => {
    loadTokens();
    if (user) {
      setProfile({ name: user.name, email: user.email });
      setTtls({
        screenshot: user.default_screenshot_ttl_days ?? '',
        file: user.default_file_ttl_days ?? '',
        link: user.default_link_ttl_days ?? '',
      });
    }
  }, [loadTokens, user]);

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
