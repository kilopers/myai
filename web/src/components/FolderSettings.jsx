import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Tooltip,
} from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LinkIcon from '@mui/icons-material/Link';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SyncIcon from '@mui/icons-material/Sync';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import client from '../api/client';
import AppDialog from './AppDialog';
import { notifyFoldersChanged } from './FolderTree';

const TTL_OPTIONS = [
  { value: '', label: 'Вечно / наследовать' },
  { value: '1', label: '1 день' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '365', label: 'Год' },
];

const onColor = 'primary.main';
const offColor = 'action.disabled';

/**
 * Настройки текущей папки иконками в шапке страницы файлов:
 * ссылка, срок хранения, конвертация, режим торрентов,
 * синхронизация, переименование и удаление. Каждая иконка —
 * переключатель/действие, состояние видно по цвету и тултипу.
 */
export default function FolderSettings({ folder, onAction }) {
  const [ttlOpen, setTtlOpen] = useState(false);
  const [ttl, setTtl] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTtl, setShareTtl] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState('');

  if (!folder) return null;

  // Обновляем и сайдбар-дерево (folders-changed), и список файлов с
  // объектом текущей папки (files-changed → FilesPage load()).
  const refresh = (msg) => {
    notifyFoldersChanged();
    window.dispatchEvent(new Event('files-changed'));
    if (msg) onAction?.(msg);
  };

  const saveTtl = async () => {
    await client.post('/api/action', {
      action: 'folders.setTtl',
      id: folder.id,
      default_ttl_days: ttl === '' ? null : Number(ttl),
    });
    setTtlOpen(false);
    refresh('Срок хранения обновлён');
  };

  const toggleConversion = async () => {
    const wasOff = folder.conversion_enabled === false;
    await client.put(`/api/folders/${folder.id}`, { conversion_enabled: wasOff });
    refresh(wasOff ? 'Конвертация включена' : 'Конвертация выключена');
  };

  const toggleTorrent = async () => {
    const next = folder.torrent_mode === 'manual' ? 'auto' : 'manual';
    await client.put(`/api/folders/${folder.id}`, { torrent_mode: next });
    refresh(next === 'manual' ? 'Торренты — ручной запуск' : 'Торренты — автозапуск');
  };

  const toggleSyncExcluded = async () => {
    await client.put(`/api/folders/${folder.id}`, { sync_excluded: !folder.sync_excluded });
    refresh(folder.sync_excluded
      ? 'Папка снова синхронизируется'
      : 'Папка исключена из синхронизации');
  };

  const syncBranch = async () => {
    await client.post('/api/action', { action: 'sync.branch', folder_id: folder.id });
    refresh(`Синхронизация ветки «${folder.name}» запрошена`);
  };

  const rename = async () => {
    const n = name.trim();
    if (!n) return;
    await client.put(`/api/folders/${folder.id}`, { name: n });
    setRenameOpen(false);
    refresh('Папка переименована');
  };

  const remove = async () => {
    if (!window.confirm(`Удалить папку «${folder.name}» вместе с файлами?`)) return;
    await client.post('/api/action', { action: 'folders.delete', id: folder.id });
    notifyFoldersChanged();
    // files.state для удалённой папки ответит 404 — FilesPage
    // сам уведёт в корень.
    window.dispatchEvent(new Event('files-changed'));
  };

  const createShare = async () => {
    const { data } = await client.post('/api/share-links', {
      type: 'folder',
      id: folder.id,
      can_write: canWrite,
      ...(shareTtl === '' ? {} : { ttl_days: Number(shareTtl) }),
    });
    setShareUrl(data.url);
    await navigator.clipboard.writeText(data.url).catch(() => {});
    refresh('Ссылка создана и скопирована');
  };

  const convOn = folder.conversion_enabled !== false;
  const manual = folder.torrent_mode === 'manual';
  const syncOn = !folder.sync_excluded;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Tooltip title={folder.active_links > 0 ? `Ссылка на папку (активных: ${folder.active_links})` : 'Ссылка на папку'}>
        <IconButton
          size="small"
          onClick={() => { setShareTtl(''); setCanWrite(false); setShareUrl(''); setShareOpen(true); }}
          sx={{ color: folder.active_links > 0 ? onColor : undefined }}
        >
          <LinkIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={`Срок хранения файлов: ${folder.default_ttl_days ? `${folder.default_ttl_days} дн.` : 'наследуется'}`}>
        <IconButton
          size="small"
          onClick={() => { setTtl(String(folder.default_ttl_days ?? '')); setTtlOpen(true); }}
          sx={{ color: folder.default_ttl_days ? onColor : undefined }}
        >
          <ScheduleIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={`Конвертация файлов: ${convOn ? 'вкл — клик выключит' : 'выкл — клик включит'}`}>
        <IconButton size="small" onClick={toggleConversion} sx={{ color: convOn ? onColor : offColor }}>
          <AutorenewIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={`Торренты: ${manual ? 'ручной запуск — клик: автозапуск' : 'автозапуск — клик: вручную'}`}>
        <IconButton size="small" onClick={toggleTorrent} sx={{ color: manual ? onColor : offColor }}>
          <TouchAppIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {!folder.is_system && (
        <Tooltip title={syncOn ? 'Синхронизируется — клик исключит из синка' : 'Не синхронизируется — клик вернёт'}>
          <IconButton size="small" onClick={toggleSyncExcluded} sx={{ color: syncOn ? onColor : offColor }}>
            {syncOn ? <CloudSyncIcon fontSize="small" /> : <CloudOffIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      )}
      {!folder.sync_excluded && (
        <Tooltip title="Синхронизировать ветку сейчас">
          <IconButton size="small" onClick={syncBranch}>
            <SyncIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {!folder.is_system && (
        <Tooltip title="Переименовать">
          <IconButton size="small" onClick={() => { setName(folder.name); setRenameOpen(true); }}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {!folder.is_system && (
        <Tooltip title="Удалить папку">
          <IconButton size="small" color="error" onClick={remove}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      {/* Срок хранения */}
      <AppDialog open={ttlOpen} onClose={() => setTtlOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Папка «{folder.name}»</DialogTitle>
        <DialogContent sx={{ pt: 4 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Срок хранения файлов по умолчанию</InputLabel>
            <Select
              value={ttl}
              label="Срок хранения файлов по умолчанию"
              onChange={(e) => setTtl(e.target.value)}
            >
              {TTL_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTtlOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={saveTtl}>Сохранить</Button>
        </DialogActions>
      </AppDialog>

      {/* Ссылка на папку */}
      <AppDialog open={shareOpen} onClose={() => setShareOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Ссылка на папку «{folder.name}»</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 4 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Срок жизни ссылки</InputLabel>
            <Select
              value={shareTtl}
              label="Срок жизни ссылки"
              onChange={(e) => setShareTtl(e.target.value)}
            >
              {TTL_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={canWrite}
                onChange={(e) => setCanWrite(e.target.checked)}
              />
            }
            label="Разрешить загрузку файлов по ссылке"
          />
          {shareUrl && (
            <Alert
              severity="success"
              sx={{ wordBreak: 'break-all' }}
              action={
                <IconButton size="small" onClick={() => navigator.clipboard.writeText(shareUrl)}>
                  <LinkIcon fontSize="small" />
                </IconButton>
              }
            >
              {shareUrl}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareOpen(false)}>Закрыть</Button>
          <Button variant="contained" onClick={createShare}>Создать ссылку</Button>
        </DialogActions>
      </AppDialog>

      {/* Переименовать */}
      <AppDialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Переименовать папку</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            size="small"
            label="Имя папки"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && rename()}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={rename} disabled={!name.trim()}>Сохранить</Button>
        </DialogActions>
      </AppDialog>
    </Box>
  );
}
