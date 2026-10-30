import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, CircularProgress, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import client from '../api/client';
import ShareShell from '../components/ShareShell';
import ShareFileView from '../components/ShareFileView';

/**
 * Публичный просмотр файла по ссылке: /share/f/:token — файловая
 * ссылка, /share/d/:token/file/:uuid — файл внутри расшаренной папки.
 */
export default function ShareFilePage() {
  const { token, uuid } = useParams();
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('loading'); // loading|error|gone

  useEffect(() => {
    setStatus('loading');
    const url = uuid
      ? `/api/share/${token}/file/${uuid}`
      : `/api/share/${token}`;
    client.get(url)
      .then(({ data }) => setFile(data.file ?? null))
      .catch((e) => setStatus(e.response?.status === 410 ? 'gone' : 'error'));
  }, [token, uuid]);

  const actions = file && (
    <Button
      color="inherit"
      variant="outlined"
      size="small"
      startIcon={<DownloadIcon />}
      href={`/api/share/${token}/file/${file.uuid}/download`}
      sx={{ borderColor: 'rgba(255,255,255,.5)', whiteSpace: 'nowrap', ml: 2 }}
    >
      Скачать оригинал
    </Button>
  );

  return (
    <ShareShell title={file?.name ?? 'Файл'} actions={actions}>
      {file ? (
        <ShareFileView token={token} file={file} />
      ) : status === 'loading' ? (
        <CircularProgress />
      ) : (
        <Typography color="text.secondary">
          {status === 'gone' ? 'Срок жизни ссылки истёк.' : 'Ссылка недействительна или файл удалён.'}
        </Typography>
      )}
    </ShareShell>
  );
}
