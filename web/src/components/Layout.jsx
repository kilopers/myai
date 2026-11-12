import { useCallback, useEffect, useState } from 'react';
import {
  AppBar,
  Box,
  CircularProgress,
  Drawer,
  IconButton,
  ListSubheader,
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
import ImageIcon from '@mui/icons-material/ImageOutlined';
import FolderIcon from '@mui/icons-material/FolderOutlined';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAltOutlined';
import StorageIcon from '@mui/icons-material/StorageOutlined';
import KeyIcon from '@mui/icons-material/KeyOutlined';
import ViewKanbanIcon from '@mui/icons-material/ViewKanbanOutlined';
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

// Палитра меню по прототипу: нейтральные серые тона.
const C = { text: '#3f3f46', muted: '#71717a', hover: '#f0f0f1', sel: '#e9e9eb', line: '#e4e4e7', bg: '#fafafa' };
const itemSx = {
  borderRadius: 1.5,
  color: C.text,
  '&:hover': { bgcolor: C.hover },
  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: C.sel, color: '#18181b' },
};
const subSx = { ...itemSx, py: 0.375, pl: 1.25, mb: 0.125 };

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
    { to: '/', label: 'Скриншоты', icon: <ImageIcon />, group: 'Рабочее' },
    { to: '/files', label: 'Файлы', icon: <FolderIcon />, section: 'files' },
    { to: '/passwords', label: 'Пароли', icon: <KeyIcon />, section: 'passwords' },
    { to: '/boards', label: 'Доски', icon: <ViewKanbanIcon />, section: 'boards' },
    { to: '/trash', label: 'Корзина', icon: <DeleteIcon />, group: 'Система' },
    { to: '/releases', label: 'Релизы', icon: <SystemUpdateAltIcon /> },
    { to: '/storage', label: 'Хранилище', icon: <StorageIcon /> },
    ...(user?.is_admin
      ? [{ to: '/admin', label: 'Админка', icon: <AdminPanelSettingsIcon /> }]
      : []),
    { to: '/settings', label: 'Настройки', icon: <SettingsIcon /> },
  ];

  const expanded = open || isMobile;
  const subWrap = { ml: 2.25, pl: 1, borderLeft: `1px solid ${C.line}`, mb: 0.5 };

  const nav = (
    <Box sx={{ overflowY: 'auto', flexGrow: 1 }}>
      <List sx={{ px: 0.75, pt: 0.5 }}>
        {items.map((item, idx) => {
          const selected = item.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.to);
          const groupHead = expanded && item.group && (
            <ListSubheader disableSticky sx={{ bgcolor: 'transparent', color: C.muted, fontSize: 12, lineHeight: '28px', px: 0.75, mt: idx ? 1.5 : 0.5 }}>
              {item.group}
            </ListSubheader>
          );
          const btn = (
            <Box key={item.to}>
              {groupHead}
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
                  ...itemSx,
                  mb: 0.125,
                  // В свёрнутой колонке (56px) больше вертикальных паддингов —
                  // иконка с ховером становится квадратной, а не прямоугольной.
                  py: expanded ? 0.5 : 1.75,
                  px: expanded ? 0.75 : 0.5,
                  justifyContent: expanded ? 'initial' : 'center',
                  '& .MuiListItemIcon-root': { color: C.muted, minWidth: expanded ? 32 : 0 },
                  '& .MuiListItemIcon-root svg': { fontSize: 18 },
                  '&.Mui-selected .MuiListItemIcon-root': { color: '#18181b' },
                }}
              >
                <ListItemIcon sx={{ minWidth: expanded ? 32 : 0, justifyContent: 'center' }}>
                  {item.icon}
                </ListItemIcon>
                {(open || isMobile) && (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: '14px', fontWeight: selected ? 500 : 400 }}
                  />
                )}
                {/* Стрелка сворачивания — кружок с ховером; mr −2px,
                    чтобы справа оставалось 4px, как сверху и снизу */}
                {item.section && (open || isMobile) && (
                  <Box
                    component="span"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSection(item.section);
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      color: C.muted,
                      cursor: 'pointer',
                      mr: -0.25,
                      '&:hover': { bgcolor: C.line, color: C.text },
                    }}
                  >
                    {menuState[item.section]
                      ? <ExpandMoreIcon sx={{ fontSize: 16 }} />
                      : <ChevronRightIcon sx={{ fontSize: 16 }} />}
                  </Box>
                )}
              </ListItemButton>
              {item.to === '/passwords' && (open || isMobile) && menuState.passwords && pwFolders.length > 0 && (
                <Box sx={subWrap}>
                  {pwFolders.map((f) => (
                    <ListItemButton
                      key={f.id}
                      selected={location.pathname === '/passwords' && searchParams.get('folder') === String(f.id)}
                      onClick={() => {
                        navigate(`/passwords?folder=${f.id}`);
                        if (isMobile) toggle();
                      }}
                      sx={subSx}
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
                <Box sx={subWrap}>
                  {boards.map((b) => (
                    <ListItemButton
                      key={b.id}
                      selected={location.pathname === `/boards/${b.id}`}
                      onClick={() => {
                        navigate(`/boards/${b.id}`);
                        if (isMobile) toggle();
                      }}
                      sx={subSx}
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
                <Box sx={subWrap}>
                <FolderTree
                  folders={folders}
                  currentFolderId={currentFolderId}
                  onNodeClick={(f) => {
                    navigate(`/files?folder=${f.id}`);
                    if (isMobile) toggle();
                  }}
                  onAction={setNotice}
                />
                </Box>
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
            bgcolor: C.bg,
            borderRight: `1px solid ${C.line}`,
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
            color: C.muted,
            pb: 1,
            fontSize: '0.7rem',
            userSelect: 'none',
          }}
        >
          v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}
        </Typography>
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
      </Box>

      <Snackbar open={!!notice} autoHideDuration={3500} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}
