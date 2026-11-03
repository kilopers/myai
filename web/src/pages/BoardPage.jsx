import { useCallback } from 'react';
import { Fab, InputAdornment, Link, TextField, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink, useParams } from 'react-router-dom';
import client from '../api/client';
import BoardCanvas from '../components/board/BoardCanvas';
import PageHeader from '../components/PageHeader';

/**
 * Доска владельца: полотно BoardCanvas поверх авторизованного API,
 * шапка — PageHeader с крошками и кнопкой добавления колонки.
 */
export default function BoardPage() {
  const { id } = useParams();
  const boardId = Number(id);

  const fetchData = useCallback(async () => {
    const [{ data: boards }, { data: cols }] = await Promise.all([
      client.get('/api/boards', { params: { all: 1 } }),
      client.get('/api/board-columns', { params: { board_id: boardId } }),
    ]);
    const list = boards.data ?? boards;
    return {
      board: list.find((b) => b.id === boardId) ?? { id: boardId, name: 'Доска' },
      columns: cols.data ?? cols,
    };
  }, [boardId]);

  return (
    <BoardCanvas
      apiBase="/api"
      fetchData={fetchData}
      header={({ board, openColumnCreate, query, setQuery }) => (
        <PageHeader
          crumbs={(
            <Link component={RouterLink} to="/boards" underline="hover" color="inherit">
              Доски
            </Link>
          )}
          title={board?.name ?? '…'}
          actions={(
            <>
              <TextField
                size="small"
                placeholder="Поиск по доске…"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
                // На мобильной — отдельной строкой на всю ширину (после кнопки +)
                sx={{ width: { xs: '100%', sm: 220 }, order: { xs: 3, sm: 0 } }}
              />
              {openColumnCreate && (
                <Tooltip title="Добавить колонку">
                  <Fab size="small" color="primary" onClick={openColumnCreate}>
                    <AddIcon />
                  </Fab>
                </Tooltip>
              )}
            </>
          )}
        />
      )}
    />
  );
}
