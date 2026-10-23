import { useState } from 'react';
import {
  AppBar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import { Outlet, Link as RouterLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DRAWER_WIDTH = 200;
const COLLAPSED_WIDTH = 56;
const OPEN_KEY = 'drawer_open';

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const isMobile = useMediaQuery((theme) => theme.breakpoints.down('md'));
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0');

  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      return !v;
    });
  };

  const items = [
    { to: '/', label: 'Скриншоты', icon: <ImageIcon /> },
    { to: '/files', label: 'Файлы', icon: <FolderIcon /> },
    ...(user?.is_admin
      ? [{ to: '/admin', label: 'Админка', icon: <AdminPanelSettingsIcon /> }]
      : []),
    { to: '/settings', label: 'Настройки', icon: <SettingsIcon /> },
  ];

  const nav = (
    <List sx={{ px: 0.75, pt: 0.75 }}>
      {items.map((item) => {
        const selected = item.to === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(item.to);
        const btn = (
          <ListItemButton
            key={item.to}
            component={RouterLink}
            to={item.to}
            selected={selected}
            onClick={isMobile ? toggle : undefined}
            sx={{
              borderRadius: 1.5,
              mb: 0.25, py: 0.5,
              justifyContent: open || isMobile ? 'initial' : 'center',
              '&.Mui-selected': {
                bgcolor: 'rgba(16,104,191,.1)',
                color: 'primary.main',
                '& .MuiListItemIcon-root': { color: 'primary.main' },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: open || isMobile ? 40 : 0, justifyContent: 'center' }}>
              {item.icon}
            </ListItemIcon>
            {(open || isMobile) && <ListItemText primary={item.label} />}
          </ListItemButton>
        );
        return open || isMobile
          ? btn
          : <Tooltip key={item.to} title={item.label} placement="right">{btn}</Tooltip>;
      })}
    </List>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <Toolbar variant="dense">
          <IconButton color="inherit" edge="start" onClick={toggle} sx={{ mr: 1.5 }}>
            <MenuIcon />
          </IconButton>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ color: 'inherit', textDecoration: 'none', flexGrow: 1 }}
          >
            Screenshoter
          </Typography>
          <Typography variant="body2" sx={{ mr: 1, opacity: 0.85 }}>
            {user?.name}
          </Typography>
          <IconButton color="inherit" onClick={logout} title="Выйти">
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? open : true}
        onClose={toggle}
        sx={{
          width: open ? DRAWER_WIDTH : COLLAPSED_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: open ? DRAWER_WIDTH : COLLAPSED_WIDTH,
            boxSizing: 'border-box',
            transition: (theme) => theme.transitions.create('width'),
            overflowX: 'hidden',
          },
        }}
      >
        <Toolbar variant="dense" />
        {nav}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 } }}>
        <Toolbar variant="dense" />
        <Outlet />
      </Box>
    </Box>
  );
}
