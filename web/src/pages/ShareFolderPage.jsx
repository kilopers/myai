import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import ImageIcon from '@mui/icons-material/Image';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import VideoFileIcon from '@mui/icons-material/VideoFile';
import ArchiveIcon from '@mui/icons-material/Archive';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import client from '../api/client';
import ShareShell from '../components/ShareShell';

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

/**
 * Публичный просмотр расшаренной папки /share/d/:token: содержимое
 * без авторизации. Если владелец разрешил загрузку (can_write) —
 * под списком есть область загрузки файлов в эту папку.
 */
export default function ShareFolderPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState('loading'); // loading|error|gone
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState([]); // [{id,name,progress,done,error}]
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/api/share/${token}`);
      setInfo(data);
      setStatus('ok');
    } catch (e) {
      setStatus(e.response?.status === 410 ? 'gone' : 'error');
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const uploadFiles = async (list) => {
    for (const f of list) {
      const entry = { id: crypto.randomUUID(), name: f.name, progress: 0, done: false, error: false };
      setUploads((u) => [...u, entry]);
      const fd = new FormData();
      fd.append('file', f);
      try {
        await client.post(`/api/share/${token}/upload`, fd, {
          onUploadProgress: (e) => {
            const pct = f.size ? Math.min(100, Math.round((e.loaded / f.size) * 100)) : 0;
            setUploads((u) => u.map((x) => (x.id === entry.id ? { ...x, progress: pct } : x)));
          },
        });
        setUploads((u) => u.map((x) => (x.id === entry.id ? { ...x, progress: 100, done: true } : x)));
      } catch (err) {
        setUploads((u) => u.map((x) => (x.id === entry.id
          ? { ...x, error: true, errorText: err.response?.data?.message || 'ошибка загрузки' }
          : x)));
      }
      setTimeout(() => setUploads((u) => u.filter((x) => x.id !== entry.id)), 5000);
    }
    load();
  };

  return (
    <ShareShell title={info?.name ? `Папка «${info.name}»` : 'Папка'}>
      {status === 'loading' && <CircularProgress />}
      {status !== 'loading' && status !== 'ok' && (
        <Typography color="text.secondary">
          {status === 'gone' ? 'Срок жизни ссылки истёк.' : 'Ссылка недействительна или папка удалена.'}
        </Typography>
      )}
      {info && (
        <Box sx={{ width: 'min(96vw, 960px)', alignSelf: 'center' }}>
          {info.files?.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', my: 4 }}>
              Папка пустая{info.can_write ? ' — загрузите первый файл ниже.' : '.'}
            </Typography>
          )}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
              gap: 1,
              mb: 2,
            }}
          >
            {info.files?.map((f) => (
              <Card
                key={f.uuid}
                onClick={() => navigate(`/share/d/${token}/file/${f.uuid}`)}
                sx={{ cursor: 'pointer', '&:hover': { boxShadow: 4 } }}
              >
                <Box
                  sx={{
                    height: 84,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'action.hover',
                    '& svg': { fontSize: 40 },
                  }}
                >
                  {f.mime_type?.startsWith('image/') ? (
                    <Box
                      component="img"
                      src={`/api/share/${token}/file/${f.uuid}/raw`}
                      alt={f.name}
                      loading="lazy"
                      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    fileIcon(f.mime_type)
                  )}
                </Box>
                <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                  <Tooltip title={f.name}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                      {f.name}
                    </Typography>
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary">
                    {fmtSize(f.size)}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>

          {uploads.map((u) => (
            <Box key={u.id} sx={{ mb: 1 }}>
              <Typography variant="caption" color={u.done ? 'success.main' : u.error ? 'error.main' : 'text.secondary'}>
                {u.name} — {u.done ? 'загружен' : u.error ? (u.errorText ?? 'ошибка загрузки') : `${u.progress}%`}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={u.progress}
                color={u.done ? 'success' : u.error ? 'error' : 'primary'}
              />
            </Box>
          ))}

          {info.can_write && (
            <Box
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) uploadFiles([...e.dataTransfer.files]);
              }}
              sx={{
                mt: 2,
                py: 4,
                px: 2,
                border: '2px dashed',
                borderRadius: 2,
                borderColor: dragOver ? 'primary.main' : 'divider',
                bgcolor: dragOver ? 'action.hover' : 'background.paper',
                cursor: 'pointer',
                textAlign: 'center',
                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
              }}
            >
              <CloudUploadIcon sx={{ fontSize: 36, mb: 0.5, color: dragOver ? 'primary.main' : 'text.secondary' }} />
              <Typography sx={{ fontWeight: 500 }}>
                {dragOver ? 'Отпусти — файлы загрузятся' : 'Перетащи файлы сюда'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                владелец разрешил загрузку в эту папку · или нажми, чтобы выбрать
              </Typography>
              <input
                ref={inputRef}
                type="file"
                hidden
                multiple
                onChange={(e) => { uploadFiles([...e.target.files]); e.target.value = ''; }}
              />
            </Box>
          )}
        </Box>
      )}
    </ShareShell>
  );
}
