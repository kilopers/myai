import { useCallback } from 'react';
import { Fab, Link, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
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
      header={({ board, openColumnCreate }) => (
        <PageHeader
          crumbs={(
            <Link component={RouterLink} to="/boards" underline="hover" color="inherit">
              Доски
            </Link>
          )}
          title={board?.name ?? '…'}
          actions={(
            <Tooltip title="Добавить колонку">
              <Fab size="small" color="primary" onClick={openColumnCreate}>
                <AddIcon />
              </Fab>
            </Tooltip>
          )}
        />
      )}
    />
  );
}
