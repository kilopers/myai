import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import DataList from './DataList';

/**
 * Единый справочник (порт подхода Reference из mediccrm на MUI):
 * заголовок + «Создать», строка фильтров (text — поиск с дебаунсом,
 * select — точное значение), таблица на десктопе / карточки на
 * мобильной (DataList), пагинация, действия строк из meta.can.
 *
 * meta: {
 *   label: string,                 — заголовок списка
 *   addLabel?: string,             — текст кнопки создания ('Создать')
 *   columns: [{key,label,render,align}],
 *   filters?: [{name,label,type:'text'|'select',options?:[{value,label}]}],
 *   can?: {create,edit,delete},    — какие действия показывать
 * }
 * fetch(params) => Promise<{data: [], total: number}>
 *   params: page (1-based) + значения фильтров по name + extraParams.
 * extraParams — постоянные параметры запроса (напр. папка), смена ключа
 *   перезагружает список; refreshKey — бамп для внешней перезагрузки.
 * onFiltersChange(filters) — текущие значения фильтров наружу
 *   (страница может менять заголовок/колонки при поиске).
 */
export default function Reference({
  meta, fetch, onAdd, onEdit, onDelete, extraActions, onRow,
  extraParams, refreshKey = 0, perPage = 20,
  empty = 'Нет записей', onFiltersChange,
}) {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({});
  const [error, setError] = useState('');
  const fetchRef = useRef(fetch);
  const extraRef = useRef(extraParams);
  const filtersRef = useRef(filters);
  const debounceRef = useRef(null);
  fetchRef.current = fetch;
  extraRef.current = extraParams;
  filtersRef.current = filters;

  const load = useCallback(async (p, f) => {
    setError('');
    try {
      const { data, total: t } = await fetchRef.current({
        page: p + 1, ...extraRef.current, ...f,
      });
      setRows(data ?? []);
      setTotal(t ?? (data ?? []).length);
    } catch {
      setError('Не удалось загрузить список');
    }
  }, []);

  // Первая загрузка, смена страницы, внешний бамп, смена extraParams.
  useEffect(() => {
    load(page, filtersRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, refreshKey, JSON.stringify(extraParams)]);

  const applyFilter = (name, value, instant = false) => {
    const next = { ...filtersRef.current, [name]: value };
    filtersRef.current = next;
    setFilters(next);
    onFiltersChange?.(next);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      load(0, next);
    }, instant ? 0 : 300);
  };

  const hasActions = Boolean(
    (meta.can?.edit && onEdit) || (meta.can?.delete && onDelete) || extraActions,
  );
  const actionsFn = hasActions ? (row) => (
    <>
      {extraActions?.(row)}
      {meta.can?.edit && onEdit && (
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(row); }}>
          <EditIcon sx={{ fontSize: 16 }} />
        </IconButton>
      )}
      {meta.can?.delete && onDelete && (
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(row); }}>
          <DeleteIcon sx={{ fontSize: 16 }} />
        </IconButton>
      )}
    </>
  ) : undefined;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" sx={{ flexGrow: 1, minWidth: 120 }}>
          {meta.label}
        </Typography>
        {meta.can?.create && onAdd && (
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onAdd}>
            {meta.addLabel ?? 'Создать'}
          </Button>
        )}
      </Box>
      {(meta.filters ?? []).length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          {meta.filters.map((f) => (f.type === 'select' ? (
            <TextField
              key={f.name}
              select
              size="small"
              label={f.label}
              value={filters[f.name] ?? ''}
              onChange={(e) => applyFilter(f.name, e.target.value, true)}
              sx={{ minWidth: 180, width: { xs: '100%', sm: 'auto' } }}
            >
              <MenuItem value="">{`${f.label}: все`}</MenuItem>
              {(f.options ?? []).map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField
              key={f.name}
              size="small"
              placeholder={`${f.label}…`}
              value={filters[f.name] ?? ''}
              onChange={(e) => applyFilter(f.name, e.target.value)}
              sx={{ width: { xs: '100%', sm: 260 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )))}
        </Box>
      )}
      {error && (
        <Typography color="error" variant="body2" sx={{ mb: 1 }}>{error}</Typography>
      )}
      {!rows ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <DataList
          columns={meta.columns}
          rows={rows}
          actions={actionsFn}
          onRow={onRow}
          empty={empty}
        />
      )}
      {rows && total > perPage && (
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={perPage}
          rowsPerPageOptions={[perPage]}
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
        />
      )}
    </Box>
  );
}
