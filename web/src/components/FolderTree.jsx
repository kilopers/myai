import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LinkIcon from '@mui/icons-material/Link';
import client from '../api/client';

const TTL_OPTIONS = [
  { value: '', label: 'Вечно / наследовать' },
  { value: '1', label: '1 день' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '365', label: 'Год' },
];

export const notifyFoldersChanged = () => window.dispatchEvent(new Event('folders-changed'));

/**
 * Дерево папок для сайдбара: произвольная вложенность, раскрытие
 * шевроном, действия папки — контекстное меню по «⋮» на hover.
 */
export default function FolderTree({ folders, currentFolderId, onNodeClick, onAction }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [menu, setMenu] = useState(null); // {anchor, folder}
  const [nameDialog, setNameDialog] = useState(null); // {mode:'create'|'rename', folder, value}
  const [ttlDialog, setTtlDialog] = useState(null); // {folder, value}
  const [shareDialog, setShareDialog] = useState(null); // {folder, ttl, url}
  const navigate = useNavigate();

  // Дети по parent_id, отсортированные по имени
  const byParent = useMemo(() => {
    const map = new Map();
    for (const f of folders) {
      const key = f.parent_id ?? 0;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(f);
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    }
    return map;
  }, [folders]);

  // Авто-раскрытие предков текущей папки
  useEffect(() => {
    if (!currentFolderId) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = folders.find((f) => f.id === currentFolderId);
      while (cur?.parent_id) {
        next.add(cur.parent_id);
        cur = folders.find((f) => f.id === cur.parent_id);
      }
      return next;
    });
  }, [currentFolderId, folders]);

  const openMenu = (e, folder) => {
    e.stopPropagation();
    setMenu({ anchor: e.currentTarget, folder });
  };

  const act = (fn) => () => {
    setMenu(null);
    fn(menu?.folder);
  };

  const submitName = async () => {
    const { mode, folder, value } = nameDialog;
    const name = value.trim();
    if (!name) return;
    if (mode === 'create') {
      await client.post('/api/action', { action: 'folders.create', name, parent_id: folder?.id ?? null });
    } else {
      await client.put(`/api/folders/${folder.id}`, { name });
    }
    setNameDialog(null);
    notifyFoldersChanged();
  };

  const saveTtl = async () => {
    await client.post('/api/action', {
      action: 'folders.setTtl',
      id: ttlDialog.folder.id,
      default_ttl_days: ttlDialog.value === '' ? null : Number(ttlDialog.value),
    });
    setTtlDialog(null);
    notifyFoldersChanged();
  };

  const createShare = async () => {
    const { data } = await client.post('/api/share-links', {
      type: 'folder',
      id: shareDialog.folder.id,
      ...(shareDialog.ttl === '' ? {} : { ttl_days: Number(shareDialog.ttl) }),
    });
    setShareDialog((d) => ({ ...d, url: data.url }));
    await navigator.clipboard.writeText(data.url).catch(() => {});
  };

  const removeFolder = async (folder) => {
    await client.post('/api/action', { action: 'folders.delete', id: folder.id });
    notifyFoldersChanged();
    if (currentFolderId === folder.id) navigate('/files');
  };

  const syncBranch = async (folder) => {
    await client.post('/api/action', { action: 'sync.branch', folder_id: folder.id });
    onAction?.(`Синхронизация ветки «${folder.name}» запрошена`);
  };

  const renderNode = (folder, depth) => {
    const children = byParent.get(folder.id) ?? [];
    const isOpen = expanded.has(folder.id);
    const selected = folder.id === currentFolderId;

    return (
      <Box key={folder.id}>
        <ListItemButton
          selected={selected}
          onClick={() => onNodeClick(folder)}
          sx={{
            borderRadius: 1.5,
            py: 0.3,
            pl: `${8 + depth * 14}px`,
            pr: 0.5,
            mb: 0.125,
            color: '#303030',
            '&:hover': { bgcolor: '#e4e4ee' },
            '&:hover .folder-menu-btn': { opacity: 1 },
            '&.Mui-selected': { bgcolor: '#dcdce9', '&:hover': { bgcolor: '#d5d5e3' } },
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => {
                const next = new Set(prev);
                next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id);
                return next;
              });
            }}
            sx={{
              mr: 0.25,
              p: 0.25,
              visibility: children.length ? 'visible' : 'hidden',
              '& svg': { fontSize: 16 },
            }}
          >
            {isOpen ? <ExpandMoreIcon /> : <ChevronRightIcon />}
          </IconButton>
          <ListItemIcon sx={{ minWidth: 26, color: '#626168', '& svg': { fontSize: 18 } }}>
            <FolderIcon />
          </ListItemIcon>
          <ListItemText
            primary={folder.name}
            primaryTypographyProps={{
              fontSize: '0.82rem',
              noWrap: true,
              fontWeight: selected ? 600 : 400,
            }}
          />
          <IconButton
            className="folder-menu-btn"
            size="small"
            onClick={(e) => openMenu(e, folder)}
            sx={{ p: 0.25, opacity: 0, '& svg': { fontSize: 16 } }}
          >
            <MoreVertIcon />
          </IconButton>
        </ListItemButton>
        {isOpen && children.map((c) => renderNode(c, depth + 1))}
      </Box>
    );
  };

  return (
    <>
      <Box sx={{ px: 0.5 }}>
        {(byParent.get(0) ?? []).map((f) => renderNode(f, 0))}
      </Box>

      <Menu
        anchorEl={menu?.anchor}
        open={!!menu}
        onClose={() => setMenu(null)}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem onClick={act((f) => setNameDialog({ mode: 'create', folder: f, value: '' }))}>
          Создать подпапку
        </MenuItem>
        <MenuItem onClick={act((f) => setShareDialog({ folder: f, ttl: '', url: '' }))}>
          Ссылка на папку
        </MenuItem>
        <MenuItem onClick={act((f) => setTtlDialog({ folder: f, value: f.default_ttl_days ?? '' }))}>
          Срок хранения
        </MenuItem>
        <MenuItem onClick={act((f) => syncBranch(f))}>Синхронизировать ветку</MenuItem>
        {!menu?.folder?.is_system && (
          <MenuItem onClick={act((f) => setNameDialog({ mode: 'rename', folder: f, value: f.name }))}>
            Переименовать
          </MenuItem>
        )}
        {!menu?.folder?.is_system && (
          <MenuItem onClick={act((f) => removeFolder(f))} sx={{ color: 'error.main' }}>
            Удалить
          </MenuItem>
        )}
      </Menu>

      {/* Создать / переименовать */}
      <Dialog open={!!nameDialog} onClose={() => setNameDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {nameDialog?.mode === 'create' ? `Подпапка в «${nameDialog?.folder?.name}»` : 'Переименовать папку'}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            size="small"
            label="Имя папки"
            value={nameDialog?.value ?? ''}
            onChange={(e) => setNameDialog((d) => ({ ...d, value: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && submitName()}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNameDialog(null)}>Отмена</Button>
          <Button variant="contained" onClick={submitName}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      {/* Срок хранения */}
      <Dialog open={!!ttlDialog} onClose={() => setTtlDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Папка «{ttlDialog?.folder?.name}»</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Срок хранения файлов по умолчанию</InputLabel>
            <Select
              value={ttlDialog?.value ?? ''}
              label="Срок хранения файлов по умолчанию"
              onChange={(e) => setTtlDialog((d) => ({ ...d, value: e.target.value }))}
            >
              {TTL_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTtlDialog(null)}>Отмена</Button>
          <Button variant="contained" onClick={saveTtl}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      {/* Ссылка на папку */}
      <Dialog open={!!shareDialog} onClose={() => setShareDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Ссылка на папку «{shareDialog?.folder?.name}»</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Срок жизни ссылки</InputLabel>
            <Select
              value={shareDialog?.ttl ?? ''}
              label="Срок жизни ссылки"
              onChange={(e) => setShareDialog((d) => ({ ...d, ttl: e.target.value }))}
            >
              {TTL_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {shareDialog?.url && (
            <Alert
              severity="success"
              sx={{ wordBreak: 'break-all' }}
              action={
                <IconButton size="small" onClick={() => navigator.clipboard.writeText(shareDialog.url)}>
                  <LinkIcon fontSize="small" />
                </IconButton>
              }
            >
              {shareDialog.url}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareDialog(null)}>Закрыть</Button>
          <Button variant="contained" onClick={createShare}>Создать ссылку</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
