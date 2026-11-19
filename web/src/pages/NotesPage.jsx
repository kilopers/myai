import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import FolderIcon from '@mui/icons-material/Folder';
import StickyNote2Icon from '@mui/icons-material/StickyNote2';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import client from '../api/client';
import AppDialog from '../components/AppDialog';
import PageHeader from '../components/PageHeader';
import RichTextEditor from '../components/RichTextEditor';

/** Стили рендера HTML заметки — как read-only описание задачи. */
const htmlSx = {
  '& p': { m: 0, mb: 0.5 },
  '& ul, & ol': { pl: 3, m: 0, mb: 0.5 },
  '& blockquote': {
    borderLeft: '3px solid', borderColor: 'divider',
    m: 0, mb: 0.5, pl: 1.5, color: 'text.secondary',
  },
  '& img': { maxWidth: '100%', borderRadius: 1 },
  '& a': { color: 'primary.main' },
};

export default function NotesPage() {
  const [folders, setFolders] = useState(null);
  const [notes, setNotes] = useState(null);
  // 0 — «Все заметки» без фильтра по папке
  const [searchParams] = useSearchParams();
  const urlFolder = Number(searchParams.get('folder')) || 0;
  const [activeId, setActiveId] = useState(urlFolder);
  useEffect(() => {
    setActiveId(urlFolder);
  }, [urlFolder]);
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('');
  const [folderDlg, setFolderDlg] = useState(null); // {id?, name}
  const [saving, setSaving] = useState(false);
  // Заметка в режиме редактирования: {id, title, text, note_folder_id}
  const [editing, setEditing] = useState(null);
  const editorRef = useRef(null);

  const loadFolders = useCallback(async () => {
    try {
      const { data } = await client.get('/api/note-folders');
      setFolders(data.data ?? []);
    } catch {
      setFolders([]);
    }
  }, []);

  const loadNotes = useCallback(async () => {
    try {
      const params = {};
      if (activeId) params.note_folder_id = activeId;
      if (q.trim()) params.q = q.trim();
      const { data } = await client.get('/api/notes', { params });
      setNotes(data.data ?? []);
    } catch {
      setNotes([]);
      setMessage('Не удалось загрузить заметки');
    }
  }, [activeId, q]);

  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => {
    const t = setTimeout(loadNotes, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadNotes, q]);

  const saveFolder = async () => {
    const name = folderDlg.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (folderDlg.id) {
        await client.put(`/api/note-folders/${folderDlg.id}`, { name });
      } else {
        await client.post('/api/note-folders', { name });
      }
      window.dispatchEvent(new Event('note-folders-changed'));
      setFolderDlg(null);
      await loadFolders();
    } catch {
      setMessage('Не удалось сохранить папку');
    } finally {
      setSaving(false);
    }
  };

  const removeFolder = async (folder) => {
    if (!window.confirm(`Удалить папку «${folder.name}» вместе с заметками (${folder.notes_count})?`)) return;
    try {
      await client.delete(`/api/note-folders/${folder.id}`);
      window.dispatchEvent(new Event('note-folders-changed'));
      if (activeId === folder.id) setActiveId(0);
      await Promise.all([loadFolders(), loadNotes()]);
    } catch {
      setMessage('Не удалось удалить папку');
    }
  };

  const createNote = async () => {
    try {
      const { data } = await client.post('/api/notes', {
        note_folder_id: activeId || null,
        title: 'Новая заметка',
        text: '',
      });
      const note = data.data;
      setEditing({ ...note });
      loadFolders();
    } catch {
      setMessage('Не удалось создать заметку');
    }
  };

  const saveEditing = async () => {
    // HTML берём прямо из редактора — не теряем изменения в гонках state
    const liveText = editorRef.current
      ? (editorRef.current.isEmpty ? '' : editorRef.current.getHTML())
      : editing.text;
    const title = editing.title.trim() || 'Без названия';
    try {
      await client.put(`/api/notes/${editing.id}`, {
        title, text: liveText ?? '', note_folder_id: editing.note_folder_id ?? null,
      });
      setEditing(null);
      await Promise.all([loadNotes(), loadFolders()]);
    } catch {
      setMessage('Не удалось сохранить заметку');
    }
  };

  const removeNote = async (note) => {
    if (!window.confirm(`Удалить заметку «${note.title}»?`)) return;
    try {
      await client.delete(`/api/notes/${note.id}`);
      if (editing?.id === note.id) setEditing(null);
      await Promise.all([loadNotes(), loadFolders()]);
    } catch {
      setMessage('Не удалось удалить заметку');
    }
  };

  return (
    <Box>
      <PageHeader
        crumbs={[{ label: 'Заметки' }]}
        title={activeId ? folders?.find((f) => f.id === activeId)?.name ?? 'Заметки' : 'Заметки'}
        actions={(
          <Button variant="contained" startIcon={<AddIcon />} onClick={createNote}>
            Новая заметка
          </Button>
        )}
      />

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Card sx={{ width: 260, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
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
                    <StickyNote2Icon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Все заметки"
                    secondary={`${folders.reduce((s, f) => s + (f.notes_count ?? 0), 0)} замет.`}
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
                      secondary={`${f.notes_count} замет.`}
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

        <Box sx={{ flex: 1, minWidth: { xs: 0, sm: 420 } }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Поиск по заметкам…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ mb: 2 }}
            autoComplete="off"
          />
          {!notes ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
          ) : notes.length === 0 ? (
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 6 }}>
                <Typography color="text.secondary">
                  {q ? 'Ничего не найдено' : 'Заметок пока нет — создайте первую'}
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {notes.map((n) => (
                <Card key={n.id} sx={{ '&:hover .note-actions': { opacity: 1 } }}>
                  <CardContent>
                    {editing?.id === n.id ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                          <TextField
                            size="small"
                            label="Название"
                            value={editing.title}
                            onChange={(e) => setEditing((d) => ({ ...d, title: e.target.value }))}
                            sx={{ flex: 1, minWidth: 180 }}
                            autoComplete="off"
                          />
                          <FormControl size="small" sx={{ minWidth: 160 }}>
                            <InputLabel>Папка</InputLabel>
                            <Select
                              label="Папка"
                              value={editing.note_folder_id ?? ''}
                              onChange={(e) => setEditing((d) => ({
                                ...d, note_folder_id: e.target.value || null,
                              }))}
                            >
                              <MenuItem value="">Без папки</MenuItem>
                              {(folders ?? []).map((f) => (
                                <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Box>
                        <RichTextEditor
                          value={editing.text ?? ''}
                          onChange={(html) => setEditing((d) => ({ ...d, text: html }))}
                          placeholder="Текст заметки"
                          minHeight={160}
                          editorRef={editorRef}
                        />
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                          <Button onClick={() => setEditing(null)}>Отмена</Button>
                          <Button variant="contained" onClick={saveEditing}>Сохранить</Button>
                        </Box>
                      </Box>
                    ) : (
                      <Box sx={{ position: 'relative' }}>
                        <Box
                          className="note-actions"
                          sx={{
                            position: 'absolute', top: 0, right: 0, display: 'flex',
                            opacity: 0, transition: 'opacity 0.15s',
                            bgcolor: 'background.paper', borderRadius: 1,
                            '@media (hover: none)': { opacity: 1 },
                          }}
                        >
                          <Tooltip title="Редактировать">
                            <IconButton size="small" onClick={() => setEditing({ ...n })}>
                              <EditIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Удалить">
                            <IconButton size="small" onClick={() => removeNote(n)}>
                              <DeleteIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                        <Typography variant="subtitle1" sx={{ pr: 7 }}>
                          {n.title}
                        </Typography>
                        {n.folder && !activeId && (
                          <Typography variant="caption" color="text.secondary">
                            {n.folder.name}
                          </Typography>
                        )}
                        <Box sx={{ mt: 0.5, fontSize: '0.875rem', ...htmlSx }}>
                          {n.text
                            ? <Box dangerouslySetInnerHTML={{ __html: n.text }} />
                            : <Typography color="text.disabled" sx={{ fontSize: '0.85rem' }}>Пусто</Typography>}
                        </Box>
                        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1 }}>
                          {dayjs(n.updated_at).format('DD.MM.YYYY HH:mm')}
                        </Typography>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <AppDialog open={!!folderDlg} onClose={() => setFolderDlg(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{folderDlg?.id ? 'Переименовать папку' : 'Новая папка'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Название"
            sx={{ mt: 1 }}
            value={folderDlg?.name ?? ''}
            onChange={(e) => setFolderDlg((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && saveFolder()}
            autoComplete="off"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFolderDlg(null)} disabled={saving}>Отмена</Button>
          <Button variant="contained" onClick={saveFolder} disabled={saving || !folderDlg?.name?.trim()}>
            Сохранить
          </Button>
        </DialogActions>
      </AppDialog>

      <Snackbar
        open={!!message}
        autoHideDuration={3000}
        onClose={() => setMessage('')}
        message={message}
      />
    </Box>
  );
}
