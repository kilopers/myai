import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RestoreIcon from '@mui/icons-material/Restore';
import client from '../api/client';
import Reference from '../components/Reference';
import { useAuth } from '../context/AuthContext';

const fmtSize = (bytes) =>
  bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${(bytes / 1024).toFixed(1)} КБ`;

const fmtDate = (iso) => new Date(iso).toLocaleString();

const itemColumns = [
  { key: 'name', label: 'Название', render: (i) => <Box component="span" sx={{ fontWeight: 500 }}>{i.name}</Box> },
  { key: 'path', label: 'Путь', render: (i) => (
      <Box component="span" sx={{ color: 'text.secondary' }}>{i.original_path || '—'}</Box>
    ) },
  { key: 'size', label: 'Размер', render: (i) => (
      <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtSize(i.size)}</Box>
    ) },
  { key: 'deleted', label: 'Удалено', render: (i) => (
      <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtDate(i.deleted_at)}</Box>
    ) },
];

const kindLabel = { file: 'Файл', screenshot: 'Скриншот', folder: 'Папка' };

const logColumns = [
  { key: 'name', label: 'Название', render: (i) => <Box component="span" sx={{ fontWeight: 500 }}>{i.name}</Box> },
  { key: 'kind', label: 'Тип', render: (i) => kindLabel[i.kind] ?? i.kind },
  { key: 'path', label: 'Путь', render: (i) => (
      <Box component="span" sx={{ color: 'text.secondary' }}>{i.dir_path || 'корень'}</Box>
    ) },
  { key: 'size', label: 'Размер', render: (i) => (
      <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtSize(i.size)}</Box>
    ) },
  { key: 'deleted', label: 'Удалено', render: (i) => (
      <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtDate(i.deleted_at)}</Box>
    ) },
];

/** Корзина: списки файлов/скриншотов и журнал на едином Reference. */
export default function TrashPage() {
  const { user, setUser } = useAuth();
  const [trashDays, setTrashDays] = useState('14');
  const [trash, setTrash] = useState({ files: [], screenshots: [] });
  const [trashTab, setTrashTab] = useState(0);
  const [refKey, setRefKey] = useState(0);
  const [message, setMessage] = useState('');

  const loadTrash = useCallback(async () => {
    const { data } = await client.get('/api/trash');
    setTrash({ files: data.files ?? [], screenshots: data.screenshots ?? [] });
  }, []);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  useEffect(() => {
    if (user) {
      setTrashDays(String(user.trash_retention_days ?? 14));
    }
  }, [user]);

  // Элементы корзины: отдаём Reference срез нужной вкладки с
  // клиентской фильтрацией по имени и пагинацией.
  const fetchTrash = useCallback(async ({ q, page, kind }) => {
    const { data } = await client.get('/api/trash');
    let all = kind === 'file' ? data.files ?? [] : data.screenshots ?? [];
    if (q?.trim()) {
      const s = q.trim().toLowerCase();
      all = all.filter((i) => i.name.toLowerCase().includes(s));
    }
    return { data: all.slice((page - 1) * 20, page * 20), total: all.length };
  }, []);

  const fetchLog = useCallback(async ({ q, page }) => {
    const { data } = await client.get('/api/trash/log');
    let all = data.entries ?? [];
    if (q?.trim()) {
      const s = q.trim().toLowerCase();
      all = all.filter((i) => i.name.toLowerCase().includes(s));
    }
    return { data: all.slice((page - 1) * 20, page * 20), total: all.length };
  }, []);

  const restore = async (item) => {
    await client.post(`/api/trash/${trashTab === 0 ? 'file' : 'screenshot'}/${item.id}/restore`);
    setMessage(`«${item.name}» восстановлено`);
    loadTrash();
    setRefKey((k) => k + 1);
  };

  const destroy = async (item) => {
    await client.delete(`/api/trash/${trashTab === 0 ? 'file' : 'screenshot'}/${item.id}`);
    loadTrash();
    setRefKey((k) => k + 1);
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Корзина
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Удалённые файлы и скриншоты хранятся в корзине, потом удаляются
            насовсем. На десктопе корзина не отображается.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              type="number"
              label="Хранить удалённые файлы, дней"
              value={trashDays}
              onChange={(e) => setTrashDays(e.target.value)}
              slotProps={{ htmlInput: { min: 0 } }}
              sx={{ flexGrow: 1 }}
            />
            <Button
              variant="contained"
              onClick={async () => {
                const { data } = await client.put('/api/me', {
                  trash_retention_days: trashDays === '' ? 14 : Number(trashDays),
                });
                setUser(data.data ?? data);
                setMessage('Настройка корзины сохранена');
              }}
            >
              Сохранить
            </Button>
            <Button
              variant="outlined"
              color="error"
              disabled={trash.files.length + trash.screenshots.length === 0}
              onClick={async () => {
                await client.delete('/api/trash');
                setMessage('Корзина очищена');
                loadTrash();
                setRefKey((k) => k + 1);
              }}
            >
              Очистить корзину
            </Button>
          </Box>

          <Tabs value={trashTab} onChange={(_, v) => setTrashTab(v)} sx={{ mb: 2 }}>
            <Tab label={`Файлы (${trash.files.length})`} />
            <Tab label={`Скриншоты (${trash.screenshots.length})`} />
            <Tab label="Логи" />
          </Tabs>

          {trashTab === 2 ? (
            <Reference
              key="log"
              meta={{
                label: 'Журнал удалений',
                columns: logColumns,
                filters: [{ name: 'q', label: 'Поиск по названию', type: 'text' }],
              }}
              fetch={fetchLog}
              refreshKey={refKey}
              empty="Журнал пуст."
            />
          ) : (
            <Reference
              key={trashTab}
              meta={{
                label: trashTab === 0 ? 'Файлы в корзине' : 'Скриншоты в корзине',
                columns: itemColumns,
                filters: [{ name: 'q', label: 'Поиск по названию', type: 'text' }],
              }}
              fetch={fetchTrash}
              extraParams={{ kind: trashTab === 0 ? 'file' : 'screenshot' }}
              refreshKey={refKey}
              extraActions={(item) => (
                <>
                  <Tooltip title="Восстановить">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); restore(item); }}>
                      <RestoreIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Удалить навсегда">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(e) => { e.stopPropagation(); destroy(item); }}
                    >
                      <DeleteForeverIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </>
              )}
              empty="Корзина пуста."
            />
          )}
        </CardContent>
      </Card>

      <Snackbar
        open={!!message}
        autoHideDuration={3000}
        onClose={() => setMessage('')}
        message={message}
      />
    </Box>
  );
}
