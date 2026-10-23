import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function AdminPage() {
  const { user: me } = useAuth();
  const [invites, setInvites] = useState([]);
  const [users, setUsers] = useState([]);
  const [days, setDays] = useState(7);
  const [message, setMessage] = useState('');
  const [editUser, setEditUser] = useState(null);

  const load = useCallback(async () => {
    const [inv, usr] = await Promise.all([
      client.get('/api/admin/invites'),
      client.get('/api/admin/users'),
    ]);
    setInvites(inv.data.data);
    setUsers(usr.data.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createInvite = async () => {
    const { data } = await client.post('/api/admin/invites', { expires_in_days: days });
    setMessage('Инвайт создан');
    await navigator.clipboard.writeText(data.data.url);
    load();
  };

  const revokeInvite = async (id) => {
    await client.delete(`/api/admin/invites/${id}`);
    load();
  };

  const deleteUser = async (id) => {
    await client.delete(`/api/admin/users/${id}`);
    load();
  };

  const saveUser = async () => {
    await client.put(`/api/admin/users/${editUser.id}`, {
      name: editUser.name,
      email: editUser.email,
    });
    setEditUser(null);
    load();
  };

  const statusColor = { active: 'success', used: 'default', expired: 'warning' };
  const statusLabel = { active: 'Активен', used: 'Использован', expired: 'Истёк' };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Приглашения
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              type="number"
              label="Срок (дней)"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              sx={{ width: 130 }}
              slotProps={{ htmlInput: { min: 1, max: 90 } }}
            />
            <Button variant="contained" onClick={createInvite}>
              Создать инвайт
            </Button>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ссылка</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Истекает</TableCell>
                <TableCell>Использовал</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invites.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {inv.url}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={statusLabel[inv.status]} color={statusColor[inv.status]} />
                  </TableCell>
                  <TableCell>{new Date(inv.expires_at).toLocaleDateString()}</TableCell>
                  <TableCell>{inv.used_by || '—'}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => navigator.clipboard.writeText(inv.url)}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => revokeInvite(inv.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Пользователи
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Имя</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Роль</TableCell>
                <TableCell>Скриншотов</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.is_admin ? <Chip size="small" label="Админ" color="primary" /> : 'Пользователь'}</TableCell>
                  <TableCell>{u.screenshots_count}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setEditUser({ ...u })}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    {u.id !== me.id && (
                      <IconButton size="small" onClick={() => deleteUser(u.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editUser} onClose={() => setEditUser(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Пользователь</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            size="small"
            label="Имя"
            value={editUser?.name ?? ''}
            onChange={(e) => setEditUser((u) => ({ ...u, name: e.target.value }))}
          />
          <TextField
            size="small"
            type="email"
            label="Email"
            value={editUser?.email ?? ''}
            onChange={(e) => setEditUser((u) => ({ ...u, email: e.target.value }))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditUser(null)}>Отмена</Button>
          <Button variant="contained" onClick={saveUser}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!message} autoHideDuration={3000} onClose={() => setMessage('')} message={message} />
    </Box>
  );
}
