import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import client from '../api/client';
import ShareShell from '../components/ShareShell';

/**
 * Публичный просмотр скриншота /share/i/:uuid — картинка в интерфейсе
 * приложения + кнопка скачивания. Сама картинка доступна по /i/{uuid}.{ext}
 * (сырой URL остаётся для встраивания в мессенджеры).
 */
export default function ShareShotPage() {
  const { uuid } = useParams();
  const [shot, setShot] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    client.get(`/api/share-shot/${uuid}`)
      .then(({ data }) => setShot(data))
      .catch(() => setError(true));
  }, [uuid]);

  return (
    <ShareShell
      title={shot?.name ?? 'Скриншот'}
      actions={shot && (
        <Button
          color="inherit"
          variant="outlined"
          size="small"
          startIcon={<DownloadIcon />}
          href={shot.url}
          download={shot.name}
          sx={{ borderColor: 'rgba(255,255,255,.5)', whiteSpace: 'nowrap', ml: 2 }}
        >
          Скачать
        </Button>
      )}
    >
      {shot ? (
        <Box
          component="img"
          src={shot.url}
          alt={shot.name}
          sx={{ maxWidth: '100%', maxHeight: '82vh', objectFit: 'contain', display: 'block' }}
        />
      ) : error ? (
        <Typography color="text.secondary">Скриншот не найден или удалён.</Typography>
      ) : (
        <CircularProgress />
      )}
    </ShareShell>
  );
}
