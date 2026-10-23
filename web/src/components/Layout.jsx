import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material';
import { Outlet, Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ color: 'inherit', textDecoration: 'none', flexGrow: 1 }}
          >
            Screenshoter
          </Typography>
          <Button color="inherit" component={RouterLink} to="/">
            Галерея
          </Button>
          {user?.is_admin && (
            <Button color="inherit" component={RouterLink} to="/admin">
              Админка
            </Button>
          )}
          <Button color="inherit" component={RouterLink} to="/settings">
            Настройки
          </Button>
          <Button color="inherit" onClick={logout}>
            Выйти
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
