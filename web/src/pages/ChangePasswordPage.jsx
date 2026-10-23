import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function ChangePasswordPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current_password: '', password: '', password_confirmation: '' });
  const [error, setError] = useState('');

  const onChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await client.post('/api/auth/change-password', form);
      setUser({ ...user, must_change_password: false });
      navigate('/', { replace: true });
    } catch (err) {
      const errors = err.response?.data?.errors;
      setError(errors ? Object.values(errors).flat().join(' ') : 'Ошибка смены пароля');
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 12 }}>
      <Card sx={{ width: 420 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Смена пароля
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Ты вошёл с паролем по умолчанию — задай новый, чтобы продолжить.
          </Alert>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box component="form" onSubmit={onSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label="Текущий пароль" type="password" value={form.current_password} onChange={onChange('current_password')} required fullWidth />
            <TextField label="Новый пароль" type="password" value={form.password} onChange={onChange('password')} required fullWidth />
            <TextField label="Новый пароль ещё раз" type="password" value={form.password_confirmation} onChange={onChange('password_confirmation')} required fullWidth />
            <Button type="submit" variant="contained">
              Сохранить
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
