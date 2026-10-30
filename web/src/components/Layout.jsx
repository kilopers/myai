import { useCallback, useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  CircularProgress,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Snackbar,
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
import DeleteIcon from '@mui/icons-material/Delete';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { Outlet, Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import { onWsStatus } from '../api/ws';
import FolderTree from './FolderTree';

const DRAWER_WIDTH = 300;
const COLLAPSED_WIDTH = 56;
const OPEN_KEY = 'drawer_open';

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useMediaQuery((theme) => theme.breakpoints.down('md'));
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0');
  const [folders, setFolders] = useState([]);
  const [notice, setNotice] = useState('');
  const [wsState, setWsState] = useState('disconnected');

  useEffect(() => onWsStatus(setWsState), []);

  const isFiles = location.pathname.startsWith('/files');
  const currentFolderId = isFiles && searchParams.get('folder')
    ? Number(searchParams.get('folder'))
    : null;

  const loadFolders = useCallback(async () => {
    try {
      const { data } = await client.get('/api/folders');
      setFolders(data.data ?? data);
    } catch {
      /* дерево не критично — не мешаем работе страницы */
    }
  }, []);

  useEffect(() => {
    loadFolders();
    const onChanged = () => loadFolders();
    window.addEventListener('folders-changed', onChanged);
    return () => window.removeEventListener('folders-changed', onChanged);
  }, [loadFolders]);

  // Обновляем дерево после навигации (удаления/создания с других страниц)
  useEffect(() => {
    loadFolders();
  }, [location.pathname, location.search, loadFolders]);

  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      return !v;
    });
  };

  const items = [
    { to: '/', label: 'Скриншоты', icon: <ImageIcon /> },
    { to: '/files', label: 'Файлы', icon: <FolderIcon /> },
    { to: '/trash', label: 'Корзина', icon: <DeleteIcon /> },
    { to: '/releases', label: 'Релизы', icon: <SystemUpdateAltIcon /> },
    ...(user?.is_admin
      ? [{ to: '/admin', label: 'Админка', icon: <AdminPanelSettingsIcon /> }]
      : []),
    { to: '/settings', label: 'Настройки', icon: <SettingsIcon /> },
  ];

  const nav = (
    <Box sx={{ overflowY: 'auto', flexGrow: 1 }}>
      <List sx={{ px: 0.5, pt: 0.5 }}>
        {items.map((item) => {
          const selected = item.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.to);
          const btn = (
            <Box key={item.to}>
              <ListItemButton
                component={RouterLink}
                to={item.to}
                selected={selected && (item.to !== '/files' || !currentFolderId)}
                onClick={isMobile ? toggle : undefined}
                // На пункт «Файлы» можно бросить карточку — перенос в корень.
                {...(item.to === '/files' ? {
                  onDragOver: (e) => {
                    if (!e.dataTransfer.types?.includes('application/x-myai-file')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  },
                  onDrop: async (e) => {
                    const id = Number(e.dataTransfer.getData('application/x-myai-file'));
                    if (!id) return;
                    e.preventDefault();
                    try {
                      await client.post('/api/action', { action: 'files.move', id, folder_id: null });
                      window.dispatchEvent(new Event('files-changed'));
                    } catch { /* покажем через dirs.changed/перезагрузку */ }
                  },
                } : {})}
                sx={{
                  borderRadius: 1.5,
                  mb: 0.125,
                  py: 0.375,
                  px: 0.75,
                  color: '#303030',
                  justifyContent: open || isMobile ? 'initial' : 'center',
                  '& .MuiListItemIcon-root': { color: '#626168', minWidth: 38 },
                  '& .MuiListItemIcon-root svg': { fontSize: 18 },
                  '&:hover': { bgcolor: '#e4e4ee' },
                  '&.Mui-selected': {
                    bgcolor: '#dcdce9',
                    color: '#1f1e24',
                    fontWeight: 600,
                    '&:hover': { bgcolor: '#d5d5e3' },
                    '& .MuiListItemIcon-root': { color: '#535158' },
                    '& .MuiListItemText-primary': { fontWeight: 600 },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: open || isMobile ? 38 : 0, justifyContent: 'center' }}>
                  {item.icon}
                </ListItemIcon>
                {(open || isMobile) && (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: selected ? 600 : 400 }}
                  />
                )}
              </ListItemButton>
              {item.to === '/files' && (open || isMobile) && (
                <FolderTree
                  folders={folders}
                  currentFolderId={currentFolderId}
                  onNodeClick={(f) => {
                    navigate(`/files?folder=${f.id}`);
                    if (isMobile) toggle();
                  }}
                  onAction={setNotice}
                />
              )}
            </Box>
          );
          return open || isMobile
            ? btn
            : <Tooltip key={item.to} title={item.label} placement="right">{btn}</Tooltip>;
        })}
      </List>
    </Box>
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
            sx={{ color: 'inherit', textDecoration: 'none' }}
          >
            Мой AI ассистент
          </Typography>
          <Tooltip
            title={
              wsState === 'connected'
                ? 'Живое обновление подключено'
                : wsState === 'connecting'
                  ? 'Подключаемся к живому обновлению…'
                  : 'Нет соединения — обновления в реальном времени недоступны'
            }
          >
            <Box sx={{ display: 'flex', alignItems: 'center', mx: 1.5 }}>
              {wsState === 'connecting' ? (
                <CircularProgress size={12} sx={{ color: 'inherit', opacity: 0.8 }} />
              ) : (
                <Box
                  sx={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    bgcolor: wsState === 'connected' ? '#7bd88a' : '#e5534b',
                  }}
                />
              )}
            </Box>
          </Tooltip>
          <Box sx={{ flexGrow: 1 }} />
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
            bgcolor: '#eceef4',
            borderRight: '1px solid #d5d5e0',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Toolbar variant="dense" />
        {nav}
        <Typography
          variant="caption"
          sx={{
            textAlign: 'center',
            color: '#8e8e9c',
            pb: 1,
            fontSize: '0.7rem',
            userSelect: 'none',
          }}
        >
          v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}
        </Typography>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, minWidth: 0 }}>
        <Toolbar variant="dense" />
        <Outlet />
      </Box>

      <Snackbar open={!!notice} autoHideDuration={3500} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}
