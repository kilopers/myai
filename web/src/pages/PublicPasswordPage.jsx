import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LaunchIcon from '@mui/icons-material/Launch';
import client from '../api/client';
import ShareShell from '../components/ShareShell';

/** Открывает ссылку записи; без схемы дописывает https://. */
const openUrl = (u) => {
  const href = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
  window.open(href, '_blank', 'noopener');
};

/** Строка «метка + значение + копия/переход» гостевой карточки. */
const Row = ({ label, value, mono, href, onCopy }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
    <Typography variant="body2" color="text.secondary" sx={{ width: 90, flexShrink: 0 }}>
      {label}
    </Typography>
    <Typography
      variant="body2"
      sx={{
        flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere',
        fontFamily: mono ? 'monospace' : undefined,
      }}
    >
      {value}
    </Typography>
    {href ? (
      <Tooltip title="Открыть ссылку">
        <IconButton size="small" onClick={() => openUrl(href)}>
          <LaunchIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    ) : (
      <Tooltip title="Скопировать">
        <IconButton size="small" onClick={() => onCopy(value)}>
          <ContentCopyIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    )}
  </Box>
);

/**
 * Гостевая карточка записи пароля по временной ссылке /p/:token —
 * read-only просмотр полей с копированием. 410 — срок ссылки вышел.
 */
export default function PublicPasswordPage() {
  const { token } = useParams();
  const [entry, setEntry] = useState(null);
  const [status, setStatus] = useState('loading'); // loading|error|gone
  const [copied, setCopied] = useState('');

  useEffect(() => {
    client.get(`/api/public/passwords/${token}`)
      .then(({ data }) => setEntry(data))
      .catch((e) => setStatus(e.response?.status === 410 ? 'gone' : 'error'));
  }, [token]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Скопировано в буфер обмена');
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setCopied('Не удалось скопировать');
      setTimeout(() => setCopied(''), 2000);
    }
  };

  return (
    <ShareShell title={entry?.name ?? 'Запись пароля'}>
      {entry ? (
        <Card sx={{ width: '100%', maxWidth: 480 }}>
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="h6">{entry.name}</Typography>
            {entry.login && <Row label="Логин" value={entry.login} onCopy={copy} />}
            <Row label="Пароль" value={entry.password} mono onCopy={copy} />
            {entry.url && <Row label="Ссылка" value={entry.url} href={entry.url} />}
            {entry.note && (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ width: 90, flexShrink: 0 }}>
                  Заметка
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {entry.note}
                </Typography>
              </Box>
            )}
            <Typography variant="caption" color="text.secondary">
              Ссылка действует до {new Date(entry.expires_at).toLocaleString('ru-RU')}
            </Typography>
            {copied && (
              <Typography variant="caption" color="primary">{copied}</Typography>
            )}
          </CardContent>
        </Card>
      ) : status === 'loading' ? (
        <CircularProgress />
      ) : (
        <Typography color="text.secondary">
          {status === 'gone' ? 'Срок жизни ссылки истёк.' : 'Ссылка недействительна.'}
        </Typography>
      )}
    </ShareShell>
  );
}
