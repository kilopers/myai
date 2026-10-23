import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, TextField, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import client, { setToken } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function InviteRegisterPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [status, setStatus] = useState('checking');
  const [form, setForm] = useState({ name: '', email: '', password: '', password_confirmation: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client
      .get(`/api/invites/${token}`)
      .then(() => setStatus('valid'))
      .catch(() => setStatus('invalid'));
  }, [token]);

  const onChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post(`/api/register/${token}`, form);
      setToken(data.token);
      setUser(data.user);
      navigate('/', { replace: true });
    } catch (err) {
      const errors = err.response?.data?.errors;
      setError(errors ? Object.values(errors).flat().join(' ') : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'checking') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 12 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (status === 'invalid') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 12 }}>
        <Alert severity="error">Приглашение недействительно или уже использовано.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 12 }}>
      <Card sx={{ width: 400 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Регистрация по приглашению
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box component="form" onSubmit={onSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label="Имя" value={form.name} onChange={onChange('name')} required fullWidth />
            <TextField label="Email" type="email" value={form.email} onChange={onChange('email')} required fullWidth />
            <TextField label="Пароль" type="password" value={form.password} onChange={onChange('password')} required fullWidth />
            <TextField
              label="Пароль ещё раз"
              type="password"
              value={form.password_confirmation}
              onChange={onChange('password_confirmation')}
              required
              fullWidth
            />
            <Button type="submit" variant="contained" disabled={loading}>
              Зарегистрироваться
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
