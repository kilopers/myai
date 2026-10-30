import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Menu,
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
import AllInclusiveIcon from '@mui/icons-material/AllInclusive';
import ScheduleIcon from '@mui/icons-material/Schedule';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ChecklistIcon from '@mui/icons-material/Checklist';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import client from '../api/client';
import { onWsEvent } from '../api/ws';
import { notifyFoldersChanged } from '../components/FolderTree';
import FileViewerDialog, { isOfficeMime, viewMode } from '../components/FileViewerDialog';

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

// Статусы торрент-задачи: подпись чипа и цвет.
const TORRENT_STATUS = {
  awaiting_selection: { label: 'Ожидает выбора', color: 'warning' },
  downloading: { label: 'Скачивается', color: 'primary' },
  paused: { label: 'На паузе', color: 'default' },
  completed: { label: 'Скачан', color: 'success' },
  error: { label: 'Ошибка', color: 'error' },
};

// Срок хранения — иконка вместо слов: ∞ «вечно» или часы + дата удаления.
function ExpiryMark({ iso }) {
  const icon = { fontSize: 14, verticalAlign: '-2px', mr: 0.25 };
  return iso ? (
    <Tooltip title={`Удалится ${new Date(iso).toLocaleDateString()}`}>
      <Box component="span">
        <ScheduleIcon sx={icon} />
        {new Date(iso).toLocaleDateString()}
      </Box>
    </Tooltip>
  ) : (
    <Tooltip title="Хранится вечно">
      <AllInclusiveIcon sx={{ ...icon, mr: 0 }} />
    </Tooltip>
  );
}

// У типов с конвертацией после done есть производная-миниатюра
// (/thumbnail; у видео — poster-кадр). Картинки без производных
// (загружены до фичи или ещё в обработке) — полный файл, как раньше.
function thumbEndpoint(f) {
  const mime = f.mime_type || '';
  // В обработке и при ошибке — иконка типа (+ прогресс/маркер в карточке).
  if (f.conversion_status && f.conversion_status !== 'done' && f.conversion_status !== 'none') {
    return null;
  }
  if (f.conversion_status === 'done') {
    if (mime.startsWith('image/') || mime === 'application/pdf' || isOfficeMime(mime) || mime.startsWith('video/')) {
      return 'thumbnail';
    }
    return null;
  }
  // conversion_status === 'none' — легаси-файлы без обработки.
  return mime.startsWith('image/') ? 'download' : null;
}

// Миниатюра в карточке: файл приватный, грузим blob'ом.
function FileThumb({ f }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    const endpoint = thumbEndpoint(f);
    if (!endpoint) return undefined;
    let obj;
    client
      .get(`/api/files/${f.id}/${endpoint}`, { responseType: 'blob' })
      .then(({ data }) => {
        obj = URL.createObjectURL(data);
        setUrl(obj);
      })
      .catch(() => {});
    return () => {
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [f.id, f.mime_type, f.conversion_status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (url) {
    return (
      <Box
        component="img"
        src={url}
        alt={f.name}
        loading="lazy"
        sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    );
  }
  return fileIcon(f.mime_type);
}

export default function FilesPage() {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [crumbs, setCrumbs] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [editFile, setEditFile] = useState(null);
  const [editFileTtl, setEditFileTtl] = useState('');
  const [viewerFile, setViewerFile] = useState(null);
  const [torrentDialog, setTorrentDialog] = useState(null); // {id, name, files, checked:Set}
  const [torrentMenu, setTorrentMenu] = useState(null); // {anchor, torrent}
  const inputRef = useRef(null);
  const isMobile = useMediaQuery((theme) => theme.breakpoints.down('sm'));

  const folderId = searchParams.get('folder');
  const dirHashRef = useRef(null); // хэш открытой директории из files.state
  const filesRef = useRef([]); // актуальный список для ws-обработчиков
  // file_id, по которым уже догружали список после file.conversion
  const missedConversionIds = useRef(new Set());
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    missedConversionIds.current.clear();
  }, [folderId]);

  const load = useCallback(async () => {
    try {
      const r = await client.post('/api/action', {
        action: 'files.state',
        folder_id: folderId ? Number(folderId) : null,
        page,
      });
      setFolders(r.data.state.folders);
      setFiles(r.data.state.files);
      setFolder(r.data.state.folder);
      setCrumbs(r.data.state.breadcrumbs ?? []);
      setMeta(r.data.state.meta ?? null);
      dirHashRef.current = r.data.state.dir_hash ?? null;
    } catch (e) {
      // Открытая папка удалена (в т.ч. из другой вкладки) — уходим в корень.
      if (e.response?.status === 404 && folderId) setSearchParams({});
    }
  }, [folderId, page, setSearchParams]);

  useEffect(() => {
    load();
  }, [load]);

  // «Наблюдаем» за открытой директорией: сервер сверяет хэш и говорит,
  // разошлись ли данные (покрывает разрыв сокета — зовём на реконнект).
  const watch = useCallback(async () => {
    try {
      const { data } = await client.post('/api/action', {
        action: 'dir.watch',
        folder_id: folderId ? Number(folderId) : null,
        dir_hash: dirHashRef.current ?? '',
      });
      if (data.result?.diverged) await load();
    } catch {
      /* офлайн — следующий реконнект повторит */
    }
  }, [folderId, load]);

  // Push-обновления: сервер шлёт dirs.changed со списком изменённых
  // dir_hash; перезагружаемся только если изменилась именно открытая
  // папка (или корень, когда мы в нём).
  useEffect(() => {
    const offChanged = onWsEvent('dirs.changed', (data) => {
      const cur = folderId ? Number(folderId) : null;
      const hit = (data?.dirs ?? []).some(
        (d) => d.folder_id === cur && d.dir_hash !== dirHashRef.current,
      );
      if (hit) load();
      if ((data?.dirs ?? []).length > 0) notifyFoldersChanged();
    });
    const offReconnect = onWsEvent('ws.connected', () => watch());
    // Live-прогресс конвертации: точечно обновляем карточку файла.
    // Если файла нет в списке (загружен с другого устройства, а
    // dirs.changed не дошёл) — один раз перечитываем папку, чтобы
    // карточка появилась сразу, а не по окончании конвертации.
    const offConversion = onWsEvent('file.conversion', (d) => {
      if (!d?.file_id) return;
      if (
        !filesRef.current.some((f) => f.id === d.file_id) &&
        !missedConversionIds.current.has(d.file_id)
      ) {
        missedConversionIds.current.add(d.file_id);
        load();
      }
      setFiles((list) =>
        list.map((f) =>
          f.id === d.file_id
            ? {
                ...f,
                conversion_status: d.status ?? f.conversion_status,
                conversion_progress: d.progress ?? f.conversion_progress,
                pages_done: d.pages_done ?? f.pages_done,
                pages_total: d.pages_total ?? f.pages_total,
                has_derivatives: d.has_derivatives ?? f.has_derivatives,
              }
            : f,
        ),
      );
    });
    // Live-прогресс торрентов: точечно патчим карточку .torrent-файла.
    // Само появление result-папки при completed придёт через dirs.changed.
    const offTorrent = onWsEvent('torrent.updated', (d) => {
      if (!d?.id) return;
      setFiles((list) =>
        list.map((f) =>
          f.torrent?.id === d.id ? { ...f, torrent: { ...f.torrent, ...d } } : f,
        ),
      );
    });
    return () => {
      offChanged();
      offReconnect();
      offConversion();
      offTorrent();
    };
  }, [folderId, load, watch]);

  // Подстраховка: если ws-событие file.conversion не дошло (обрыв или
  // мёртвый сокет), прогресс всё равно двигается — периодически
  // перечитываем список, пока есть файлы в конвертации.
  const hasConverting = files.some(
    (f) => f.conversion_status === 'pending' || f.conversion_status === 'processing',
  );
  useEffect(() => {
    if (!hasConverting) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [hasConverting, load]);

  const fmtSpeed = (bps) =>
    bps >= 1048576 ? `${(bps / 1048576).toFixed(1)} МБ/с` : `${Math.max(1, Math.round(bps / 1024))} КБ/с`;

  const uploadFiles = async (list) => {
    // Дубли имён в одной папке запрещены: проверяем список файлов
    // и уже идущие загрузки.
    const taken = new Set(files.map((x) => x.name));
    for (const f of list) {
      if (taken.has(f.name)) {
        setMessage(`Файл «${f.name}» уже есть в этой папке — пропущен`);
        continue;
      }
      taken.add(f.name);
      const entry = { id: crypto.randomUUID(), name: f.name, progress: 0, done: false, error: false, leaving: false, speed: '' };
      setUploads((u) => [...u, entry]);
      let lastT = performance.now();
      let lastLoaded = 0;
      let curSpeed = '';
      const onProgress = (loaded) => {
        const now = performance.now();
        const dt = (now - lastT) / 1000;
        if (dt >= 0.4) {
          curSpeed = fmtSpeed((loaded - lastLoaded) / dt);
          lastT = now;
          lastLoaded = loaded;
        }
        const speed = curSpeed;
        // e.loaded включает multipart-оверхед — ограничиваем 100%.
        const pct = f.size ? Math.min(100, Math.round((loaded / f.size) * 100)) : 0;
        setUploads((u) => u.map((x) => (x.id === entry.id ? { ...x, progress: pct, speed } : x)));
      };
      try {
        // Файлы больше 4 МБ грузим чанками — размер не ограничен лимитами POST
        const CHUNK = 4 * 1024 * 1024;
        if (f.size > CHUNK) {
          const uploadId = crypto.randomUUID();
          const total = Math.ceil(f.size / CHUNK);
          for (let i = 0; i < total; i++) {
            const fd = new FormData();
            fd.append('action', 'files.uploadChunk');
            fd.append('upload_id', uploadId);
            fd.append('index', String(i));
            fd.append('total', String(total));
            fd.append('name', f.name);
            if (folder) fd.append('folder_id', String(folder.id));
            fd.append('file', f.slice(i * CHUNK, (i + 1) * CHUNK), f.name);
            await client.post('/api/action', fd, {
              onUploadProgress: (e) => onProgress(i * CHUNK + e.loaded),
            });
          }
        } else {
          const fd = new FormData();
          fd.append('file', f);
          if (folder) fd.append('folder_id', String(folder.id));
          fd.append('action', 'files.upload');
          await client.post('/api/action', fd, {
            onUploadProgress: (e) => onProgress(e.loaded),
          });
        }
      } catch {
        setMessage(`Не удалось загрузить ${f.name}`);
        setUploads((u) => u.map((x) => (x.id === entry.id ? { ...x, error: true } : x)));
        setTimeout(() => {
          setUploads((u) => u.map((x) => (x.id === entry.id ? { ...x, leaving: true } : x)));
        }, 5500);
        setTimeout(() => {
          setUploads((u) => u.filter((x) => x.id !== entry.id));
        }, 6000);
        continue;
      }
      setUploads((u) => u.map((x) => (x.id === entry.id ? { ...x, progress: 100, done: true } : x)));
      // Успешная загрузка: прогресс-бар исчезает через 3 секунды.
      setTimeout(() => {
        setUploads((u) => u.map((x) => (x.id === entry.id ? { ...x, leaving: true } : x)));
      }, 2500);
      setTimeout(() => {
        setUploads((u) => u.filter((x) => x.id !== entry.id));
      }, 3000);
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
    await client.post('/api/action', { action: 'folders.create', name: newFolderName.trim(), parent_id: folder?.id ?? null });
    setNewFolderName('');
    setNewFolderOpen(false);
    notifyFoldersChanged();
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
    // Типы с встроенным просмотрщиком — диалог; прочие — оригинал
    // в новой вкладке, как раньше.
    if (viewMode(f)) {
      setViewerFile(f);
      return;
    }
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
    await client.post('/api/action', { action: 'files.delete', id });
    load();
  };

  // --- Торренты ---
  // Диалог выбора файлов торрента: подтягивает полный список с сервера.
  const openTorrentSelect = async (f) => {
    try {
      const { data } = await client.get(`/api/torrents/${f.torrent.id}`);
      const list = data.files ?? [];
      setTorrentDialog({
        id: f.torrent.id,
        name: data.name,
        files: list,
        checked: new Set(list.map((x) => x.index)),
      });
    } catch {
      setMessage('Не удалось получить список файлов торрента');
    }
  };

  const torrentStart = async (id, fileIndexes) => {
    try {
      const body = fileIndexes === undefined ? {} : { file_indexes: fileIndexes };
      await client.post(`/api/torrents/${id}/start`, body);
    } catch (e) {
      setMessage(e.response?.data?.message || 'Не удалось запустить торрент');
    }
  };

  const torrentPause = (f) =>
    client.post(`/api/torrents/${f.torrent.id}/pause`).catch(() => {});
  const torrentResume = (f) =>
    client.post(`/api/torrents/${f.torrent.id}/resume`).catch(() => {});

  const torrentDelete = async (withData) => {
    try {
      await client.delete(`/api/torrents/${torrentMenu.torrent.id}`, {
        params: { with_data: withData ? 1 : 0 },
      });
      setTorrentMenu(null);
      load();
    } catch {
      setMessage('Не удалось удалить торрент');
    }
  };

  const expiryText = (iso) =>
    iso ? `удалится ${new Date(iso).toLocaleDateString()}` : 'хранится вечно';

  // Карточки файлов можно таскать на дерево папок слева — перемещение.
  const onFileDragStart = (e, f) => {
    e.dataTransfer.setData('application/x-myai-file', String(f.id));
    e.dataTransfer.effectAllowed = 'move';
    window.dispatchEvent(new Event('myai:file-drag'));
  };
  const onFileDragEnd = () => window.dispatchEvent(new Event('myai:file-drag-end'));

  // Дерево папок после drop шлёт 'files-changed' — перечитываем список.
  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener('files-changed', onChanged);
    return () => window.removeEventListener('files-changed', onChanged);
  }, [load]);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        {folder && (
          <IconButton
            onClick={() => {
              const p = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
              setSearchParams(p ? { folder: String(p.id) } : {});
              setPage(1);
            }}
          >
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

      {crumbs.length > 1 && (
        <Breadcrumbs sx={{ mb: 2 }}>
          <Link
            component="button"
            underline="hover"
            color="inherit"
            onClick={() => { setSearchParams({}); setPage(1); }}
          >
            Файлы
          </Link>
          {crumbs.slice(0, -1).map((c) => (
            <Link
              key={c.id}
              component="button"
              underline="hover"
              color="inherit"
              onClick={() => { setSearchParams({ folder: String(c.id) }); setPage(1); }}
            >
              {c.name}
            </Link>
          ))}
          <Typography color="text.primary">{crumbs[crumbs.length - 1].name}</Typography>
        </Breadcrumbs>
      )}

      <Box
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        sx={{
          mb: 2,
          py: 5,
          px: 2,
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
        <Box
          key={u.id}
          sx={{
            mb: 1,
            opacity: u.leaving ? 0 : 1,
            transition: 'opacity .5s ease',
          }}
        >
          <Typography variant="caption" color={u.done ? 'success.main' : u.error ? 'error.main' : 'text.secondary'}>
            {u.name} — {u.done ? 'загружен' : u.error ? 'ошибка загрузки' : `${u.progress}%${u.speed ? ` · ${u.speed}` : ''}`}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={u.progress}
            color={u.done ? 'success' : u.error ? 'error' : 'primary'}
          />
        </Box>
      ))}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))',
          gap: 1,
        }}
      >
        {files.map((f) => (
          <Card
            key={f.id}
            draggable
            onDragStart={(e) => onFileDragStart(e, f)}
            onDragEnd={onFileDragEnd}
            sx={{ display: 'flex', flexDirection: 'column' }}
          >
            <Box
              onClick={() => openFile(f)}
              sx={{
                height: 84,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                bgcolor: 'action.hover',
                overflow: 'hidden',
                '& svg': { fontSize: 40 },
              }}
            >
              <FileThumb f={f} />
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
                {fmtSize(f.size)} · <ExpiryMark iso={f.expires_at} />
              </Typography>
              {(f.conversion_status === 'pending' || f.conversion_status === 'processing') && (
                <Box sx={{ mt: 0.5 }}>
                  <Typography variant="caption" color="primary" display="block">
                    {f.pages_total
                      ? `Конвертация… стр. ${f.pages_done ?? 0} из ${f.pages_total}`
                      : `Конвертация… ${f.conversion_progress ?? 0}%`}
                  </Typography>
                  <LinearProgress
                    variant={(f.conversion_progress ?? 0) > 0 ? 'determinate' : 'indeterminate'}
                    value={f.conversion_progress ?? 0}
                    sx={{ mt: 0.5 }}
                  />
                </Box>
              )}
              {f.conversion_status === 'failed' && (
                <Typography variant="caption" color="error.main" display="block" sx={{ mt: 0.5 }}>
                  Ошибка конвертации — доступен оригинал
                </Typography>
              )}
              {f.torrent && (
                <Box sx={{ mt: 0.5 }}>
                  <Tooltip
                    title={
                      f.torrent.status === 'completed' && f.torrent.result_folder_id
                        ? 'Открыть папку с результатом'
                        : (TORRENT_STATUS[f.torrent.status]?.label ?? f.torrent.status)
                    }
                  >
                    <Chip
                      size="small"
                      color={TORRENT_STATUS[f.torrent.status]?.color ?? 'default'}
                      variant={f.torrent.status === 'downloading' ? 'filled' : 'outlined'}
                      label={
                        f.torrent.status === 'downloading'
                          ? `Торрент · ${f.torrent.progress ?? 0}%`
                          : `Торрент · ${TORRENT_STATUS[f.torrent.status]?.label ?? f.torrent.status}`
                      }
                      onClick={
                        f.torrent.status === 'completed' && f.torrent.result_folder_id
                          ? () => setSearchParams({ folder: String(f.torrent.result_folder_id) })
                          : undefined
                      }
                    />
                  </Tooltip>
                  {(f.torrent.status === 'downloading' || f.torrent.status === 'paused') && (
                    <Box sx={{ mt: 0.5 }}>
                      <LinearProgress variant="determinate" value={f.torrent.progress ?? 0} />
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                        {f.torrent.progress ?? 0}%
                        {f.torrent.download_rate > 0 ? ` · ${fmtSpeed(f.torrent.download_rate)}` : ''}
                      </Typography>
                    </Box>
                  )}
                  {f.torrent.status === 'error' && (
                    <Tooltip title={f.torrent.error ?? ''}>
                      <Typography variant="caption" color="error.main" display="block" noWrap sx={{ mt: 0.25 }}>
                        {f.torrent.error || 'Ошибка загрузки торрента'}
                      </Typography>
                    </Tooltip>
                  )}
                  <Box sx={{ display: 'flex', mt: 0.25 }}>
                    {f.torrent.status === 'awaiting_selection' && (
                      <>
                        <IconButton size="small" title="Выбрать файлы" onClick={() => openTorrentSelect(f)}>
                          <ChecklistIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" title="Скачать все файлы" onClick={() => torrentStart(f.torrent.id)}>
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                    {f.torrent.status === 'error' && (
                      <IconButton size="small" title="Повторить загрузку" onClick={() => torrentStart(f.torrent.id)}>
                        <PlayArrowIcon fontSize="small" />
                      </IconButton>
                    )}
                    {f.torrent.status === 'downloading' && (
                      <IconButton size="small" title="Пауза" onClick={() => torrentPause(f)}>
                        <PauseIcon fontSize="small" />
                      </IconButton>
                    )}
                    {f.torrent.status === 'paused' && (
                      <IconButton size="small" title="Продолжить" onClick={() => torrentResume(f)}>
                        <PlayArrowIcon fontSize="small" />
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      title="Удалить торрент"
                      onClick={(e) => setTorrentMenu({ anchor: e.currentTarget, torrent: f.torrent })}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              )}
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
      {files.length === 0 && folders.length === 0 && (
        <Typography color="text.secondary">
          Файлов пока нет — перетащи их в область выше. Папки — в дереве слева.
        </Typography>
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
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 4 }}>
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

      {/* Срок хранения файла */}
      <Dialog open={!!editFile} onClose={() => setEditFile(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{editFile?.name}</DialogTitle>
        <DialogContent sx={{ pt: 4 }}>
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

      {/* Выбор файлов торрента */}
      <Dialog open={!!torrentDialog} onClose={() => setTorrentDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Файлы торрента «{torrentDialog?.name}»</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Button
              size="small"
              onClick={() =>
                setTorrentDialog((d) => ({ ...d, checked: new Set(d.files.map((x) => x.index)) }))
              }
            >
              Все
            </Button>
            <Button
              size="small"
              onClick={() => setTorrentDialog((d) => ({ ...d, checked: new Set() }))}
            >
              Ничего
            </Button>
          </Box>
          <List dense sx={{ maxHeight: 400, overflow: 'auto' }}>
            {torrentDialog?.files.map((tf) => (
              <ListItem
                key={tf.index}
                disableGutters
                secondaryAction={
                  <Typography variant="caption" color="text.secondary">
                    {fmtSize(tf.size)}
                  </Typography>
                }
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <Checkbox
                    size="small"
                    edge="start"
                    checked={torrentDialog.checked.has(tf.index)}
                    onChange={(e) =>
                      setTorrentDialog((d) => {
                        const checked = new Set(d.checked);
                        e.target.checked ? checked.add(tf.index) : checked.delete(tf.index);
                        return { ...d, checked };
                      })
                    }
                  />
                </ListItemIcon>
                <ListItemText
                  primary={tf.path}
                  primaryTypographyProps={{ fontSize: '0.85rem', noWrap: true }}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTorrentDialog(null)}>Отмена</Button>
          <Button
            variant="contained"
            disabled={!torrentDialog || torrentDialog.checked.size === 0}
            onClick={() => {
              torrentStart(torrentDialog.id, [...torrentDialog.checked]);
              setTorrentDialog(null);
            }}
          >
            Скачать выбранные ({torrentDialog?.checked.size ?? 0})
          </Button>
        </DialogActions>
      </Dialog>

      {/* Удаление торрента: только задача или вместе с данными */}
      <Menu
        anchorEl={torrentMenu?.anchor}
        open={!!torrentMenu}
        onClose={() => setTorrentMenu(null)}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem onClick={() => torrentDelete(false)}>Удалить торрент</MenuItem>
        <MenuItem onClick={() => torrentDelete(true)} sx={{ color: 'error.main' }}>
          Удалить торрент с данными
        </MenuItem>
      </Menu>

      <Snackbar open={!!message} autoHideDuration={4000} onClose={() => setMessage('')} message={message} />

      {/* Встроенный просмотрщик файла */}
      {viewerFile && <FileViewerDialog file={viewerFile} onClose={() => setViewerFile(null)} />}
    </Box>
  );
}
