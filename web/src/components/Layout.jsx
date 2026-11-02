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
import StorageIcon from '@mui/icons-material/Storage';
import KeyIcon from '@mui/icons-material/Key';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
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
  const [boards, setBoards] = useState([]);
  // Свернутые/развёрнутые секции меню — хранится в БД (users.menu_state).
  const [menuState, setMenuState] = useState({ files: true, boards: true, passwords: true });
  const [pwFolders, setPwFolders] = useState([]);
  useEffect(() => {
    if (user?.menu_state) setMenuState((s) => ({ ...s, ...user.menu_state }));
  }, [user?.menu_state]);
  const toggleSection = (key) => {
    setMenuState((s) => {
      const next = { ...s, [key]: !s[key] };
      client.put('/api/me', { menu_state: next }).catch(() => {});
      return next;
    });
  };
  const [notice, setNotice] = useState('');
  const [wsState, setWsState] = useState('disconnected');

  useEffect(() => onWsStatus(setWsState), []);

  // Последнее место пользователя — HomeGate вернёт сюда при заходе на «/»
  useEffect(() => {
    localStorage.setItem('myai:last-url', location.pathname + location.search);
  }, [location]);

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

  const loadBoards = useCallback(async () => {
    try {
      const { data } = await client.get('/api/boards', { params: { all: 1 } });
      setBoards(data.data ?? data);
    } catch {
      /* список досок не критичен */
    }
  }, []);

  useEffect(() => {
    loadBoards();
    const onChanged = () => loadBoards();
    window.addEventListener('boards-changed', onChanged);
    return () => window.removeEventListener('boards-changed', onChanged);
  }, [loadBoards, location.pathname]);

  const loadPwFolders = useCallback(async () => {
    try {
      const { data } = await client.get('/api/password-folders');
      setPwFolders(data.data ?? data);
    } catch {
      /* список папок не критичен */
    }
  }, []);

  useEffect(() => {
    loadPwFolders();
    const onChanged = () => loadPwFolders();
    window.addEventListener('password-folders-changed', onChanged);
    return () => window.removeEventListener('password-folders-changed', onChanged);
  }, [loadPwFolders, location.pathname]);

  const toggle = () => {
    setOpen((v) => {
      localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      return !v;
    });
  };

  const items = [
    { to: '/', label: 'Скриншоты', icon: <ImageIcon /> },
    { to: '/files', label: 'Файлы', icon: <FolderIcon />, section: 'files' },
    { to: '/passwords', label: 'Пароли', icon: <KeyIcon />, section: 'passwords' },
    { to: '/boards', label: 'Доски', icon: <ViewKanbanIcon />, section: 'boards' },
    { to: '/trash', label: 'Корзина', icon: <DeleteIcon /> },
    { to: '/releases', label: 'Релизы', icon: <SystemUpdateAltIcon /> },
    { to: '/storage', label: 'Хранилище', icon: <StorageIcon /> },
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
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <ListItemButton
                component={RouterLink}
                to={item.to}
                selected={selected && (item.to !== '/files' || !currentFolderId) && (item.to !== '/boards' || location.pathname === '/boards') && (item.to !== '/passwords' || location.pathname === '/passwords' && !searchParams.get('folder'))}
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
                  // В свёрнутой колонке (56px) больше вертикальных паддингов —
                  // иконка с ховером становится квадратной, а не прямоугольной.
                  py: open || isMobile ? 0.375 : 1.75,
                  px: open || isMobile ? 0.75 : 0.5,
                  color: 'rgb(113, 116, 132)',
                  justifyContent: open || isMobile ? 'initial' : 'center',
                  '& .MuiListItemIcon-root': { color: 'rgb(113, 116, 132)', minWidth: open || isMobile ? 38 : 0 },
                  '& .MuiListItemIcon-root svg': { fontSize: 18 },
                  '&:hover': { bgcolor: 'rgb(229, 233, 251)' },
                  '&.Mui-selected': {
                    bgcolor: 'rgb(229, 233, 251)',
                    color: 'rgb(82, 109, 227)',
                    fontWeight: 600,
                    '&:hover': { bgcolor: 'rgb(229, 233, 251)' },
                    '& .MuiListItemIcon-root': { color: 'rgb(82, 109, 227)' },
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
                    primaryTypographyProps={{ fontSize: '14px', fontWeight: selected ? 600 : 400 }}
                  />
                )}
              </ListItemButton>
              {item.section && (open || isMobile) && (
                <IconButton
                  size="small"
                  onClick={() => toggleSection(item.section)}
                  sx={{ color: 'rgb(113, 116, 132)', mr: 0.5, p: 0.25 }}
                >
                  {menuState[item.section]
                    ? <ExpandMoreIcon sx={{ fontSize: 16 }} />
                    : <ChevronRightIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              )}
              </Box>
              {item.to === '/passwords' && (open || isMobile) && menuState.passwords && pwFolders.length > 0 && (
                <Box>
                  {pwFolders.map((f) => (
                    <ListItemButton
                      key={f.id}
                      selected={location.pathname === '/passwords' && searchParams.get('folder') === String(f.id)}
                      onClick={() => {
                        navigate(`/passwords?folder=${f.id}`);
                        if (isMobile) toggle();
                      }}
                      sx={{
                        borderRadius: 1.5,
                        pl: 4.5,
                        py: 0.25,
                        color: 'rgb(113, 116, 132)',
                        '&:hover': { bgcolor: 'rgb(229, 233, 251)' },
                        '&.Mui-selected': {
                          bgcolor: 'rgb(229, 233, 251)',
                          color: 'rgb(82, 109, 227)',
                          '& .MuiListItemText-primary': { fontWeight: 600 },
                        },
                      }}
                    >
                      <ListItemText
                        primary={f.name}
                        primaryTypographyProps={{ fontSize: '14px', noWrap: true }}
                      />
                    </ListItemButton>
                  ))}
                </Box>
              )}
              {item.to === '/boards' && (open || isMobile) && menuState.boards && boards.length > 0 && (
                <Box>
                  {boards.map((b) => (
                    <ListItemButton
                      key={b.id}
                      selected={location.pathname === `/boards/${b.id}`}
                      onClick={() => {
                        navigate(`/boards/${b.id}`);
                        if (isMobile) toggle();
                      }}
                      sx={{
                        borderRadius: 1.5,
                        pl: 4.5,
                        py: 0.25,
                        color: 'rgb(113, 116, 132)',
                        '&:hover': { bgcolor: 'rgb(229, 233, 251)' },
                        '&.Mui-selected': {
                          bgcolor: 'rgb(229, 233, 251)',
                          color: 'rgb(82, 109, 227)',
                          '& .MuiListItemText-primary': { fontWeight: 600 },
                        },
                      }}
                    >
                      <ListItemText
                        primary={b.name}
                        primaryTypographyProps={{ fontSize: '14px', noWrap: true }}
                      />
                    </ListItemButton>
                  ))}
                </Box>
              )}
              {item.to === '/files' && (open || isMobile) && menuState.files && (
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
            bgcolor: 'rgb(246, 248, 254)',
            borderRight: '1px solid rgb(229, 233, 251)',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Toolbar variant="dense" />
        {nav}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, md: 3 },
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Toolbar variant="dense" />
        <Outlet />
        {/* Футер только на десктопе — в мобильном приложении скрыт */}
        <Box
          component="footer"
          sx={{
            mt: 'auto',
            bgcolor: '#171321',
            color: '#fff',
            py: 0.25,
            textAlign: 'center',
            display: { xs: 'none', md: 'block' },
            '@media (display-mode: standalone)': { display: 'none' },
          }}
        >
          <Typography variant="caption" sx={{ lineHeight: 1.4 }}>
            Разработано Зорин Юрий Алексеевич, {new Date().getFullYear()},
            v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}
          </Typography>
        </Box>
      </Box>

      <Snackbar open={!!notice} autoHideDuration={3500} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}
