import { AppBar, Box, Divider, Toolbar, Typography } from '@mui/material';

/**
 * Минимальный каркас публичных страниц шаринга: только шапка
 * (название сервиса + имя объекта + действия справа), без меню
 * и сайдбара. Контент центрируется по вертикали.
 */
export default function ShareShell({ title, actions, children }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="fixed">
        <Toolbar variant="dense">
          <Typography variant="h6" noWrap>Мой AI ассистент</Typography>
          <Divider orientation="vertical" flexItem sx={{ mx: 2, borderColor: 'rgba(255,255,255,.35)' }} />
          <Typography variant="body1" noWrap sx={{ flexGrow: 1, minWidth: 0 }} title={title}>
            {title}
          </Typography>
          {actions}
        </Toolbar>
      </AppBar>
      <Toolbar variant="dense" />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
          minWidth: 0,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
