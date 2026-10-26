import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import client from '../api/client';

export default function ReleasesPage() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get('/api/desktop-version')
      .then(({ data }) => setInfo(data))
      .catch(() => setError('Не удалось получить информацию о релизе'));
  }, []);

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Релизы десктопа
          </Typography>
          <Divider sx={{ mb: 2 }} />
          {error && <Typography color="error">{error}</Typography>}
          {info && (
            <>
              <Typography variant="body1" sx={{ mb: 2 }}>
                Последняя версия: <b>v{info.version}</b>
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {info.downloads?.windows && (
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    href={info.downloads.windows}
                  >
                    Windows (.msi/.exe)
                  </Button>
                )}
                {info.downloads?.macos && (
                  <Button
                    variant="contained"
                    startIcon={<DownloadIcon />}
                    href={info.downloads.macos}
                  >
                    macOS (.dmg)
                  </Button>
                )}
                {info.notes_url && (
                  <Button
                    variant="outlined"
                    startIcon={<OpenInNewIcon />}
                    href={info.notes_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Что нового (GitHub)
                  </Button>
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                macOS: сборка неподписанная — после установки выполните
                «xattr -cr /Applications/Мой AI ассистент.app».
              </Typography>
            </>
          )}
          {!info && !error && (
            <Typography color="text.secondary">Загрузка…</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
