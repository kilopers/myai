import { AppBar, Box, Divider, Toolbar, Typography } from '@mui/material';

/**
 * Минимальный каркас публичных страниц шаринга: только шапка
 * (иконка + название сервиса + имя объекта + действия справа),
 * без меню и сайдбара.
 * fill — контент растягивается на всю высоту (доска), иначе центрируется.
 */
export default function ShareShell({ title, actions, children, fill = false }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="fixed">
        <Toolbar variant="dense">
          <Box
            component="img"
            src="/icons/icon-192.png"
            alt=""
            sx={{ width: 26, height: 26, borderRadius: 1, mr: 1.25 }}
          />
          <Typography variant="h6" noWrap>Мой AI ассистент</Typography>
          <Divider orientation="vertical" flexItem sx={{ mx: 2, borderColor: 'rgba(255,255,255,.18)' }} />
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
          alignItems: fill ? 'stretch' : 'center',
          justifyContent: fill ? 'flex-start' : 'center',
          p: fill ? { xs: 1, md: 2 } : 2,
          minWidth: 0,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
