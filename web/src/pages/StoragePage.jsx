import { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import client from '../api/client';
import PageHeader from '../components/PageHeader';

const mb = (b) => `${(b / 1048576).toFixed(1)} МБ`;

/** Человеческие подписи для каталогов public-диска в реальном замере. */
const PART_LABELS = {
  files: 'Файлы и скриншоты (files/)',
  attachments: 'Вложения задач досок (attachments/)',
  derivatives: 'Производные — конвертация, миниатюры (derivatives/)',
  desktop: 'Релизы десктоп-приложения (desktop/)',
  other: 'Прочее (служебные файлы, накладные расходы ФС)',
};

/** Донат-диаграмма «занято/свободно» без внешних библиотек. */
function Donut({ used, total }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const R = 70;
  const C = 2 * Math.PI * R;
  return (
    <Box sx={{ position: 'relative', width: 200, height: 200, mx: 'auto' }}>
      <svg width="200" height="200" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={R} fill="none" stroke="#e7dcc8" strokeWidth="24" />
        <circle
          cx="100" cy="100" r={R} fill="none" stroke="#b05f38" strokeWidth="24"
          strokeDasharray={`${(pct / 100) * C} ${C}`}
          strokeLinecap="round" transform="rotate(-90 100 100)"
        />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="h5">{pct.toFixed(1)}%</Typography>
        <Typography variant="caption" color="text.secondary">занято</Typography>
      </Box>
    </Box>
  );
}

export default function StoragePage() {
  const [data, setData] = useState(null);
  const [real, setReal] = useState(null);
  const [realError, setRealError] = useState(false);

  useEffect(() => {
    client.get('/api/storage/summary').then(({ data }) => setData(data)).catch(() => {});
    // Реальный du каталогов — медленный, грузится отдельно со спиннером.
    client.get('/api/storage/real-size')
      .then(({ data }) => setReal(data))
      .catch(() => setRealError(true));
  }, []);

  const rows = data ? [
    ['Файлы (оригиналы)', data.files],
    ['Производные файлов (конвертация, миниатюры)', data.derivatives],
    ['Скриншоты', data.screenshots],
    ['Вложения задач досок', data.attachments],
    ['Корзина', data.trash],
  ] : [];
  const dbTotal = data
    ? data.files.size + data.derivatives.size + data.screenshots.size
      + data.attachments.size + data.trash.size
    : 0;

  return (
    <Box>
      <PageHeader title="Хранилище" />
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Card sx={{ minWidth: 280, flex: '0 0 auto' }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>Диск</Typography>
            {data ? (
              <>
                <Donut used={data.disk.used} total={data.disk.total} />
                <Typography variant="body2" align="center" sx={{ mt: 1 }}>
                  Занято {mb(data.disk.used)} из {mb(data.disk.total)}
                </Typography>
                <Typography variant="body2" align="center" color="text.secondary">
                  Свободно {mb(data.disk.free)}
                </Typography>
              </>
            ) : <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}
          </CardContent>
        </Card>
        <Card sx={{ flex: 1, minWidth: 320 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>По базе данных</Typography>
            {!data ? <CircularProgress /> : (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Категория</TableCell>
                      <TableCell align="right">Кол-во</TableCell>
                      <TableCell align="right">Размер</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map(([label, r]) => (
                      <TableRow key={label}>
                        <TableCell>{label}</TableCell>
                        <TableCell align="right">{r.count}</TableCell>
                        <TableCell align="right">{mb(r.size)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Итого</TableCell>
                      <TableCell />
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{mb(dbTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Сумма размеров папок (кэш в БД): {mb(data.folders_size)}
                </Typography>
              </>
            )}
          </CardContent>
        </Card>
      </Box>
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>Реальный размер на диске</Typography>
          {realError ? (
            <Typography color="error">Не удалось измерить каталоги хранилища.</Typography>
          ) : !real ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">Измеряем каталоги…</Typography>
            </Box>
          ) : (
            <>
              <Table size="small" sx={{ maxWidth: 560 }}>
                <TableBody>
                  {Object.entries(real.parts).map(([dir, size]) => (
                    <TableRow key={dir}>
                      <TableCell>{PART_LABELS[dir] ?? `${dir}/`}</TableCell>
                      <TableCell align="right">{mb(size)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell>Торренты (staging)</TableCell>
                    <TableCell align="right">{mb(real.torrents)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Всего занято</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{mb(real.total)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', maxWidth: 560 }}>
                Замер du не обязан сходиться с суммой из БД: на диске лежат
                данные корзины до автоочистки, desktop-релизы и служебные
                файлы, которых нет в БД, плюс накладные расходы ФС на сами каталоги.
              </Typography>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
