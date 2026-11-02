import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CasinoIcon from '@mui/icons-material/Casino';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import FolderIcon from '@mui/icons-material/Folder';
import KeyIcon from '@mui/icons-material/Key';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import client from '../api/client';

const emptyForm = { name: '', login: '', password: '', note: '', expires_at: '', password_folder_id: null };
const emptyGen = {
  name: '', min_length: 12, max_length: 20,
  use_lower: true, use_upper: true, use_digits: true, use_symbols: false,
  symbols: '!@#$%^&*_-+=',
};

/** Краткое описание наборов символов алгоритма для таблицы. */
const describeGen = (g) => [
  g.use_lower && 'a–z',
  g.use_upper && 'A–Z',
  g.use_digits && '0–9',
  g.use_symbols && (g.symbols ? `«${g.symbols}»` : 'спец'),
].filter(Boolean).join(' + ');

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
  // Вкладки: 0 — записи, 1 — алгоритмы генерации.
  const [tab, setTab] = useState(0);
  const [generators, setGenerators] = useState([]);
  const [genDlg, setGenDlg] = useState(null); // {id?}
  const [genForm, setGenForm] = useState(emptyGen);
  // Меню «сгенерировать пароль» у поля пароля.
  const [genMenu, setGenMenu] = useState(null);

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

  const loadGenerators = useCallback(async () => {
    try {
      const { data } = await client.get('/api/password-generators');
      setGenerators(data.data ?? []);
    } catch {
      setGenerators([]);
    }
  }, []);

  useEffect(() => { loadFolders(); loadGenerators(); }, [loadFolders, loadGenerators]);
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
      expires_at: entry.expires_at ? entry.expires_at.slice(0, 10) : '',
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
        expires_at: form.expires_at || null,
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

  const openGenDlg = (g) => {
    setGenForm(g ? {
      name: g.name,
      min_length: g.min_length,
      max_length: g.max_length,
      use_lower: g.use_lower,
      use_upper: g.use_upper,
      use_digits: g.use_digits,
      use_symbols: g.use_symbols,
      symbols: g.symbols ?? '',
    } : emptyGen);
    setGenDlg({ id: g?.id ?? null });
  };

  const saveGen = async () => {
    if (!genForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...genForm,
        name: genForm.name.trim(),
        symbols: genForm.symbols || null,
      };
      if (genDlg.id) {
        await client.put(`/api/password-generators/${genDlg.id}`, payload);
      } else {
        await client.post('/api/password-generators', payload);
      }
      setGenDlg(null);
      await loadGenerators();
    } catch (e) {
      setMessage(e.response?.data?.message ?? 'Не удалось сохранить алгоритм');
    } finally {
      setSaving(false);
    }
  };

  const removeGen = async (g) => {
    if (!window.confirm(`Удалить алгоритм «${g.name}»?`)) return;
    try {
      await client.delete(`/api/password-generators/${g.id}`);
      await loadGenerators();
    } catch {
      setMessage('Не удалось удалить алгоритм');
    }
  };

  // Кубик у поля пароля: выбор алгоритма → генерация на сервере →
  // пароль в форму и сразу в буфер обмена.
  const runGenerate = async (gen) => {
    setGenMenu(null);
    try {
      const { data } = await client.post(`/api/password-generators/${gen.id}/generate`);
      setForm((f) => ({ ...f, password: data.password }));
      await navigator.clipboard.writeText(data.password);
      setMessage(`Пароль сгенерирован по «${gen.name}» и скопирован в буфер обмена`);
    } catch {
      setMessage('Не удалось сгенерировать пароль');
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
      <Typography variant="h5" sx={{ mb: 1 }}>Пароли</Typography>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Записи" />
        <Tab label="Алгоритмы генерации" />
      </Tabs>
      {tab === 1 ? (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle1">Алгоритмы генерации паролей</Typography>
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => openGenDlg(null)}>
                Создать
              </Button>
            </Box>
            <Table size="small" sx={{ maxWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Название</TableCell>
                  <TableCell>Длина</TableCell>
                  <TableCell>Наборы символов</TableCell>
                  <TableCell align="right">Действия</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {generators.map((g) => (
                  <TableRow key={g.id} hover>
                    <TableCell sx={{ fontWeight: 500 }}>{g.name}</TableCell>
                    <TableCell>{g.min_length}–{g.max_length}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{describeGen(g)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton size="small" onClick={() => openGenDlg(g)}>
                        <EditIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton size="small" onClick={() => removeGen(g)}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {generators.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>
                      Алгоритмов нет — создайте, чтобы генерировать пароли кубиком в диалоге записи.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
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
                    <TableCell>Срок</TableCell>
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
                      <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        {e.expires_at ? new Date(e.expires_at).toLocaleDateString('ru-RU') : '∞'}
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
                      <TableCell colSpan={showFolderCol ? 7 : 6} sx={{ color: 'text.secondary' }}>
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
      )}

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
                    <Tooltip title="Сгенерировать по алгоритму">
                      <span>
                        <IconButton
                          size="small"
                          onClick={(e) => setGenMenu(e.currentTarget)}
                          disabled={!generators.length}
                        >
                          <CasinoIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <IconButton size="small" onClick={() => setShowPass((v) => !v)} edge="end">
                      {showPass ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          {/* Выбор алгоритма генерации */}
          <Menu anchorEl={genMenu} open={!!genMenu} onClose={() => setGenMenu(null)}>
            {generators.map((g) => (
              <MenuItem key={g.id} onClick={() => runGenerate(g)}>
                <ListItemText
                  primary={g.name}
                  secondary={`${g.min_length}–${g.max_length}, ${describeGen(g)}`}
                />
              </MenuItem>
            ))}
          </Menu>
          <TextField
            label="Срок действия (пусто — навсегда)"
            type="date"
            value={form.expires_at}
            onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
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

      {/* Диалог алгоритма генерации */}
      <Dialog open={!!genDlg} onClose={() => setGenDlg(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{genDlg?.id ? 'Редактировать алгоритм' : 'Новый алгоритм'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
          <TextField
            autoFocus
            label="Название"
            value={genForm.name}
            onChange={(e) => setGenForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Длина от"
              type="number"
              value={genForm.min_length}
              onChange={(e) => setGenForm((f) => ({ ...f, min_length: Number(e.target.value) }))}
              slotProps={{ htmlInput: { min: 4, max: 512 } }}
              fullWidth
            />
            <TextField
              label="Длина до"
              type="number"
              value={genForm.max_length}
              onChange={(e) => setGenForm((f) => ({ ...f, max_length: Number(e.target.value) }))}
              slotProps={{ htmlInput: { min: 4, max: 512 } }}
              fullWidth
            />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Checkbox checked={genForm.use_lower} onChange={(e) => setGenForm((f) => ({ ...f, use_lower: e.target.checked }))} />}
              label="Строчные латиница (a–z)"
            />
            <FormControlLabel
              control={<Checkbox checked={genForm.use_upper} onChange={(e) => setGenForm((f) => ({ ...f, use_upper: e.target.checked }))} />}
              label="Заглавные латиница (A–Z)"
            />
            <FormControlLabel
              control={<Checkbox checked={genForm.use_digits} onChange={(e) => setGenForm((f) => ({ ...f, use_digits: e.target.checked }))} />}
              label="Цифры (0–9)"
            />
            <FormControlLabel
              control={<Checkbox checked={genForm.use_symbols} onChange={(e) => setGenForm((f) => ({ ...f, use_symbols: e.target.checked }))} />}
              label="Спецсимволы"
            />
          </Box>
          {genForm.use_symbols && (
            <TextField
              label="Набор спецсимволов"
              helperText="Символы, из которых будет выбираться пароль (например подчёркивание _)"
              value={genForm.symbols}
              onChange={(e) => setGenForm((f) => ({ ...f, symbols: e.target.value }))}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenDlg(null)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={saveGen}
            disabled={
              saving || !genForm.name.trim()
              || !(genForm.use_lower || genForm.use_upper || genForm.use_digits || genForm.use_symbols)
              || genForm.min_length > genForm.max_length
            }
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
