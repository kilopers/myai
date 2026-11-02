import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import FolderIcon from '@mui/icons-material/Folder';
import KeyIcon from '@mui/icons-material/Key';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import client from '../api/client';

const emptyForm = { name: '', login: '', password: '', note: '', password_folder_id: null };

export default function PasswordsPage() {
  const [folders, setFolders] = useState(null);
  // 0 — «Все записи»: весь справочник без фильтра по папке.
  const [activeId, setActiveId] = useState(0);
  const [entries, setEntries] = useState(null);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  // Диалог папки: {id?, name} — id есть при переименовании.
  const [folderDlg, setFolderDlg] = useState(null);
  // Диалог записи: {id?} + form; null — закрыт.
  const [entryDlg, setEntryDlg] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadFolders = useCallback(async () => {
    try {
      const { data } = await client.get('/api/password-folders');
      setFolders(data.data ?? []);
    } catch {
      setFolders([]);
    }
  }, []);

  const loadEntries = useCallback(async (folderId, q, p) => {
    setEntries(null);
    try {
      const params = new URLSearchParams();
      if (folderId) params.set('password_folder_id', folderId);
      if (q?.trim()) params.set('q', q.trim());
      params.set('page', p);
      const { data } = await client.get(`/api/password-entries?${params}`);
      setEntries(data.data ?? []);
      setMeta(data.meta ?? null);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);
  // Поиск с дебаунсом: непустой запрос ищет по всему справочнику,
  // пустой — показывает выбранную папку (или все записи при activeId=0).
  useEffect(() => {
    if (!folders) return;
    const t = setTimeout(() => {
      setPage(1);
      loadEntries(query.trim() ? null : activeId, query, 1);
    }, query.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [activeId, query, folders, loadEntries]);

  const goPage = (p) => {
    setPage(p);
    loadEntries(query.trim() ? null : activeId, query, p);
  };

  const reloadCurrent = () => loadEntries(query.trim() ? null : activeId, query, page);

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${what} скопирован в буфер обмена`);
    } catch {
      setMessage('Не удалось скопировать');
    }
  };

  const saveFolder = async () => {
    const name = folderDlg.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (folderDlg.id) {
        await client.put(`/api/password-folders/${folderDlg.id}`, { name });
      } else {
        const { data } = await client.post('/api/password-folders', { name });
        setActiveId(data.data?.id ?? 0);
      }
      setFolderDlg(null);
      await loadFolders();
    } catch {
      setMessage('Не удалось сохранить папку');
    } finally {
      setSaving(false);
    }
  };

  const removeFolder = async (folder) => {
    if (!window.confirm(`Удалить папку «${folder.name}» вместе со всеми записями (${folder.entries_count})?`)) return;
    try {
      await client.delete(`/api/password-folders/${folder.id}`);
      if (activeId === folder.id) setActiveId(0);
      await loadFolders();
    } catch {
      setMessage('Не удалось удалить папку');
    }
  };

  const openEntryDlg = (entry) => {
    setForm(entry ? {
      name: entry.name,
      login: entry.login ?? '',
      password: entry.password ?? '',
      note: entry.note ?? '',
      password_folder_id: entry.password_folder_id,
    } : {
      ...emptyForm,
      password_folder_id: activeId || folders?.[0]?.id || null,
    });
    setShowPass(false);
    setEntryDlg({ id: entry?.id ?? null });
  };

  const saveEntry = async () => {
    if (!form.name.trim() || !form.password || !form.password_folder_id) return;
    setSaving(true);
    try {
      const payload = {
        password_folder_id: form.password_folder_id,
        name: form.name.trim(),
        login: form.login.trim() || null,
        password: form.password,
        note: form.note.trim() || null,
      };
      if (entryDlg.id) {
        await client.put(`/api/password-entries/${entryDlg.id}`, payload);
      } else {
        await client.post('/api/password-entries', payload);
      }
      setEntryDlg(null);
      await Promise.all([reloadCurrent(), loadFolders()]);
    } catch {
      setMessage('Не удалось сохранить запись');
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (entry) => {
    if (!window.confirm(`Удалить запись «${entry.name}»?`)) return;
    try {
      await client.delete(`/api/password-entries/${entry.id}`);
      await Promise.all([reloadCurrent(), loadFolders()]);
    } catch {
      setMessage('Не удалось удалить запись');
    }
  };

  const copyCellSx = {
    cursor: 'pointer',
    borderRadius: 1,
    px: 0.5,
    mx: -0.5,
    '&:hover': { bgcolor: 'rgba(82, 109, 227, 0.08)' },
  };

  const searching = !!query.trim();
  // Показываем колонку «Папка», когда строки из разных папок (все записи / поиск).
  const showFolderCol = searching || activeId === 0;
  const title = searching
    ? `Поиск: «${query.trim()}»`
    : (activeId ? folders?.find((f) => f.id === activeId)?.name ?? 'Записи' : 'Все записи');

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Пароли</Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Card sx={{ width: 260, flexShrink: 0 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="subtitle1">Папки</Typography>
              <Tooltip title="Создать папку">
                <IconButton size="small" onClick={() => setFolderDlg({ name: '' })}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            {!folders ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={22} /></Box>
            ) : (
              <List dense disablePadding>
                <ListItemButton
                  selected={activeId === 0}
                  onClick={() => setActiveId(0)}
                  sx={{ borderRadius: 1.5, py: 0.4 }}
                >
                  <ListItemIcon sx={{ minWidth: 30, '& svg': { fontSize: 18 } }}>
                    <KeyIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Все записи"
                    secondary={`${folders.reduce((s, f) => s + (f.entries_count ?? 0), 0)} запис.`}
                    primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }}
                  />
                </ListItemButton>
                {folders.map((f) => (
                  <ListItemButton
                    key={f.id}
                    selected={f.id === activeId}
                    onClick={() => setActiveId(f.id)}
                    sx={{ borderRadius: 1.5, py: 0.4 }}
                  >
                    <ListItemIcon sx={{ minWidth: 30, '& svg': { fontSize: 18 } }}>
                      <FolderIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary={f.name}
                      secondary={`${f.entries_count} запис.`}
                      primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }}
                    />
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); setFolderDlg({ id: f.id, name: f.name }); }}
                    >
                      <EditIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeFolder(f); }}>
                      <DeleteIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </ListItemButton>
                ))}
                {folders.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    Папок нет — создайте первую.
                  </Typography>
                )}
              </List>
            )}
          </CardContent>
        </Card>

        <Card sx={{ flex: 1, minWidth: 420 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" sx={{ flexGrow: 1, minWidth: 120 }}>
                {title}
              </Typography>
              <TextField
                size="small"
                placeholder="Поиск по всему справочнику…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                sx={{ width: 260 }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <Button
                size="small"
                variant="contained"
                startIcon={<AddIcon />}
                disabled={!folders?.length}
                onClick={() => openEntryDlg(null)}
              >
                Создать
              </Button>
            </Box>
            {!entries ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Название</TableCell>
                    <TableCell>Логин</TableCell>
                    <TableCell>Пароль</TableCell>
                    <TableCell>Информация</TableCell>
                    {showFolderCol && <TableCell>Папка</TableCell>}
                    <TableCell align="right">Действия</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell sx={{ fontWeight: 500 }}>{e.name}</TableCell>
                      <TableCell>
                        {e.login ? (
                          <Tooltip title="Клик — скопировать логин">
                            <Box component="span" sx={copyCellSx} onClick={() => copy(e.login, 'Логин')}>
                              {e.login}
                            </Box>
                          </Tooltip>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Tooltip title="Клик — скопировать пароль">
                          <Box
                            component="span"
                            sx={{ ...copyCellSx, fontFamily: 'monospace', letterSpacing: 1 }}
                            onClick={() => copy(e.password, 'Пароль')}
                          >
                            ••••••••
                          </Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary', maxWidth: 220 }}>
                        <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.note || '—'}
                        </Box>
                      </TableCell>
                      {showFolderCol && (
                        <TableCell sx={{ color: 'text.secondary' }}>{e.folder?.name ?? '—'}</TableCell>
                      )}
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton size="small" onClick={() => openEntryDlg(e)}>
                          <EditIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                        <IconButton size="small" onClick={() => removeEntry(e)}>
                          <DeleteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {entries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={showFolderCol ? 6 : 5} sx={{ color: 'text.secondary' }}>
                        {searching ? 'Ничего не найдено.' : 'Записей пока нет — нажмите «Создать».'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
            {entries && meta && meta.last_page > 1 && (
              <TablePagination
                component="div"
                count={meta.total}
                page={(meta.current_page ?? page) - 1}
                rowsPerPage={20}
                rowsPerPageOptions={[20]}
                onPageChange={(e, p) => goPage(p + 1)}
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
              />
            )}
          </CardContent>
        </Card>
      </Box>

      {/* Диалог папки */}
      <Dialog open={!!folderDlg} onClose={() => setFolderDlg(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{folderDlg?.id ? 'Переименовать папку' : 'Новая папка'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Название папки"
            value={folderDlg?.name ?? ''}
            onChange={(e) => setFolderDlg((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && saveFolder()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFolderDlg(null)}>Отмена</Button>
          <Button variant="contained" onClick={saveFolder} disabled={saving || !folderDlg?.name?.trim()}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Диалог записи */}
      <Dialog open={!!entryDlg} onClose={() => setEntryDlg(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{entryDlg?.id ? 'Редактировать запись' : 'Новая запись'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Папка</InputLabel>
            <Select
              label="Папка"
              value={form.password_folder_id ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, password_folder_id: e.target.value }))}
            >
              {(folders ?? []).map((f) => (
                <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            autoFocus
            label="Название"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextField
            label="Логин"
            value={form.login}
            onChange={(e) => setForm((f) => ({ ...f, login: e.target.value }))}
          />
          <TextField
            label="Пароль"
            type={showPass ? 'text' : 'password'}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPass((v) => !v)} edge="end">
                      {showPass ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            label="Доп. информация"
            multiline
            minRows={2}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEntryDlg(null)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={saveEntry}
            disabled={saving || !form.name.trim() || !form.password || !form.password_folder_id}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!message}
        autoHideDuration={3000}
        onClose={() => setMessage('')}
        message={message}
      />
    </Box>
  );
}
