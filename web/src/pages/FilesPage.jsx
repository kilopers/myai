import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Pagination,
  Select,
  FormControl,
  InputLabel,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ImageIcon from '@mui/icons-material/Image';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import VideoFileIcon from '@mui/icons-material/VideoFile';
import ArchiveIcon from '@mui/icons-material/Archive';
import LinkIcon from '@mui/icons-material/Link';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import client from '../api/client';

const TTL_OPTIONS = [
  { value: '', label: 'По умолчанию' },
  { value: '0', label: 'Вечная' },
  { value: '1', label: '1 день' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '365', label: 'Год' },
];

function fileIcon(mime) {
  if (!mime) return <InsertDriveFileIcon />;
  if (mime === 'application/pdf') return <PictureAsPdfIcon color="error" />;
  if (mime.startsWith('image/')) return <ImageIcon color="primary" />;
  if (mime.startsWith('audio/')) return <AudioFileIcon color="secondary" />;
  if (mime.startsWith('video/')) return <VideoFileIcon color="secondary" />;
  if (/zip|tar|gzip|x-7z|rar/.test(mime)) return <ArchiveIcon />;
  return <InsertDriveFileIcon />;
}

const fmtSize = (n) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${(n / 1024).toFixed(1)} КБ`;

export default function FilesPage() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [folder, setFolder] = useState(null); // current folder object or null (root)
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState(null);
  const [uploads, setUploads] = useState([]); // [{name, progress}]
  const [dragOver, setDragOver] = useState(false);
  const [message, setMessage] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [shareDialog, setShareDialog] = useState(null); // {type:'file'|'folder', id, name}
  const [shareTtl, setShareTtl] = useState('');
  const [shareResult, setShareResult] = useState('');
  const [editFolder, setEditFolder] = useState(null);
  const [editFolderTtl, setEditFolderTtl] = useState('');
  const [editFile, setEditFile] = useState(null);
  const [editFileTtl, setEditFileTtl] = useState('');
  const inputRef = useRef(null);
  const isMobile = useMediaQuery((theme) => theme.breakpoints.down('sm'));

  const load = useCallback(async () => {
    const params = folder ? { folder_id: folder.id, page } : { page };
    const [fo, fi] = await Promise.all([
      client.get('/api/folders'),
      client.get('/api/files', { params }),
    ]);
    setFolders(fo.data.data);
    setFiles(fi.data.data);
    setMeta(fi.data.meta);
  }, [folder, page]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadFiles = async (list) => {
    for (const f of list) {
      const entry = { name: f.name, progress: 0 };
      setUploads((u) => [...u, entry]);
      const fd = new FormData();
      fd.append('file', f);
      if (folder) fd.append('folder_id', folder.id);
      try {
        await client.post('/api/files', fd, {
          onUploadProgress: (e) => {
            const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
            setUploads((u) => u.map((x) => (x === entry ? { ...x, progress: pct } : x)));
          },
        });
      } catch {
        setMessage(`Не удалось загрузить ${f.name}`);
      }
      setUploads((u) => u.filter((x) => x !== entry));
    }
    load();
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles([...e.dataTransfer.files]);
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    await client.post('/api/folders', { name: newFolderName.trim() });
    setNewFolderName('');
    setNewFolderOpen(false);
    load();
  };

  const saveFolder = async () => {
    await client.put(`/api/folders/${editFolder.id}`, {
      default_ttl_days: editFolderTtl === '' ? null : Number(editFolderTtl),
    });
    setEditFolder(null);
    load();
  };

  const saveFile = async () => {
    await client.put(`/api/files/${editFile.id}`, {
      expires_at: editFileTtl === '' ? null : ttlToIso(Number(editFileTtl)),
    });
    setEditFile(null);
    load();
  };

  const ttlToIso = (days) => new Date(Date.now() + days * 86400000).toISOString();

  const createLink = async () => {
    const { data } = await client.post('/api/share-links', {
      type: shareDialog.type,
      id: shareDialog.id,
      ...(shareTtl === '' ? {} : { ttl_days: Number(shareTtl) }),
    });
    setShareResult(data.url);
    await navigator.clipboard.writeText(data.url);
  };

  const openFile = async (f) => {
    const { data } = await client.get(`/api/files/${f.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([data], { type: f.mime_type }));
    window.open(url, '_blank');
  };

  const downloadFile = async (f) => {
    const { data } = await client.get(`/api/files/${f.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([data], { type: f.mime_type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeFile = async (id) => {
    await client.delete(`/api/files/${id}`);
    load();
  };

  const removeFolder = async (id) => {
    await client.delete(`/api/folders/${id}`);
    load();
  };

  const expiryText = (iso) =>
    iso ? `удалится ${new Date(iso).toLocaleDateString()}` : 'хранится вечно';

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        {folder && (
          <IconButton onClick={() => { setFolder(null); setPage(1); }}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Файлы{folder ? ` — ${folder.name}` : ''}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<CreateNewFolderIcon />}
          onClick={() => setNewFolderOpen(true)}
        >
          Папка
        </Button>
      </Box>

      <Box
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        sx={{
          mb: 2,
          py: 5,
          px: 2,
          maxWidth: 680,
          mx: 'auto',
          border: '2px dashed',
          borderRadius: 2,
          borderColor: dragOver ? 'primary.main' : 'divider',
          bgcolor: dragOver ? 'action.hover' : 'background.paper',
          cursor: 'pointer',
          textAlign: 'center',
          transition: 'background-color .15s ease, border-color .15s ease',
          '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
        }}
      >
        <CloudUploadIcon
          sx={{ fontSize: 40, mb: 1, color: dragOver ? 'primary.main' : 'text.secondary' }}
        />
        <Typography sx={{ fontWeight: 500 }}>
          {dragOver ? 'Отпусти — файлы загрузятся' : 'Перетащи файлы сюда'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          или нажми, чтобы выбрать на компьютере
        </Typography>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          onChange={(e) => { uploadFiles([...e.target.files]); e.target.value = ''; }}
        />
      </Box>

      {uploads.map((u) => (
        <Box key={u.name} sx={{ mb: 1, maxWidth: 680, mx: 'auto' }}>
          <Typography variant="caption">{u.name} — {u.progress}%</Typography>
          <LinearProgress variant="determinate" value={u.progress} />
        </Box>
      ))}

      {!folder && folders.length > 0 && (
        <List dense sx={{ mb: 2, maxWidth: 680, mx: 'auto', width: '100%' }}>
          {folders.map((fo) => (
            <ListItem
              key={fo.id}
              disablePadding
              secondaryAction={
                <Box>
                  <Tooltip title="Ссылка на папку">
                    <IconButton onClick={() => { setShareDialog({ type: 'folder', id: fo.id, name: fo.name }); setShareResult(''); }}>
                      <LinkIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Настройки папки">
                    <IconButton onClick={() => { setEditFolder(fo); setEditFolderTtl(fo.default_ttl_days == null ? '' : String(fo.default_ttl_days)); }}>
                      <SettingsIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <IconButton onClick={() => removeFolder(fo.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              }
            >
              <ListItemButton onClick={() => { setFolder(fo); setPage(1); }}>
                <ListItemIcon><FolderIcon color="primary" /></ListItemIcon>
                <ListItemText
                  primary={fo.name}
                  secondary={`файлов: ${fo.files_count ?? 0}`}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 130 : 150}px, 1fr))`,
          gap: 1,
        }}
      >
        {files.map((f) => (
          <Card key={f.id} sx={{ display: 'flex', flexDirection: 'column' }}>
            <Box
              onClick={() => openFile(f)}
              sx={{
                height: 84,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                bgcolor: 'action.hover',
                '& svg': { fontSize: 40 },
              }}
            >
              {fileIcon(f.mime_type)}
            </Box>
            <CardContent sx={{ p: 1, '&:last-child': { pb: 1 }, flexGrow: 1 }}>
              <Tooltip title={f.name}>
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ fontWeight: 500, cursor: 'pointer' }}
                  onClick={() => openFile(f)}
                >
                  {f.name}
                </Typography>
              </Tooltip>
              <Typography variant="caption" color="text.secondary" display="block">
                {fmtSize(f.size)} · {expiryText(f.expires_at)}
              </Typography>
            </CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', px: 0.5, pb: 0.5 }}>
              <IconButton size="small" title="Ссылка" onClick={() => { setShareDialog({ type: 'file', id: f.id, name: f.name }); setShareResult(''); }}>
                <LinkIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" title="Скачать" onClick={() => downloadFile(f)}>
                <DownloadIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" title="Срок хранения" onClick={() => { setEditFile(f); setEditFileTtl(''); }}>
                <SettingsIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" title="Удалить" onClick={() => removeFile(f.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          </Card>
        ))}
      </Box>
      {files.length === 0 && !folder && folders.length === 0 && (
        <Typography color="text.secondary">Файлов пока нет — перетащи их в область выше.</Typography>
      )}

      {meta?.last_page > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination count={meta.last_page} page={page} onChange={(_, p) => setPage(p)} />
        </Box>
      )}

      {/* Новая папка */}
      <Dialog open={newFolderOpen} onClose={() => setNewFolderOpen(false)}>
        <DialogTitle>Новая папка</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            size="small"
            label="Имя папки"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewFolderOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={createFolder}>Создать</Button>
        </DialogActions>
      </Dialog>

      {/* Ссылка с TTL */}
      <Dialog open={!!shareDialog} onClose={() => setShareDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Ссылка на {shareDialog?.type === 'folder' ? 'папку' : 'файл'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {shareDialog?.name}
          </Typography>
          <FormControl size="small" fullWidth>
            <InputLabel>Срок жизни ссылки</InputLabel>
            <Select value={shareTtl} label="Срок жизни ссылки" onChange={(e) => setShareTtl(e.target.value)}>
              {TTL_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {shareResult && (
            <Alert severity="success" sx={{ wordBreak: 'break-all' }} action={
              <IconButton size="small" onClick={() => navigator.clipboard.writeText(shareResult)}>
                <LinkIcon fontSize="small" />
              </IconButton>
            }>
              {shareResult}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareDialog(null)}>Закрыть</Button>
          <Button variant="contained" onClick={createLink}>Создать ссылку</Button>
        </DialogActions>
      </Dialog>

      {/* Настройки папки */}
      <Dialog open={!!editFolder} onClose={() => setEditFolder(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Папка «{editFolder?.name}»</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Срок хранения файлов по умолчанию</InputLabel>
            <Select value={editFolderTtl} label="Срок хранения файлов по умолчанию" onChange={(e) => setEditFolderTtl(e.target.value)}>
              <MenuItem value="">Вечно / наследовать</MenuItem>
              <MenuItem value="1">1 день</MenuItem>
              <MenuItem value="7">7 дней</MenuItem>
              <MenuItem value="30">30 дней</MenuItem>
              <MenuItem value="365">Год</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditFolder(null)}>Отмена</Button>
          <Button variant="contained" onClick={saveFolder}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      {/* Срок хранения файла */}
      <Dialog open={!!editFile} onClose={() => setEditFile(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{editFile?.name}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Срок хранения</InputLabel>
            <Select value={editFileTtl} label="Срок хранения" onChange={(e) => setEditFileTtl(e.target.value)}>
              <MenuItem value="">Вечно</MenuItem>
              <MenuItem value="1">1 день</MenuItem>
              <MenuItem value="7">7 дней</MenuItem>
              <MenuItem value="30">30 дней</MenuItem>
              <MenuItem value="365">Год</MenuItem>
            </Select>
          </FormControl>
          {editFile?.expires_at && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Сейчас: {expiryText(editFile.expires_at)}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditFile(null)}>Отмена</Button>
          <Button variant="contained" onClick={saveFile}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!message} autoHideDuration={4000} onClose={() => setMessage('')} message={message} />
    </Box>
  );
}
