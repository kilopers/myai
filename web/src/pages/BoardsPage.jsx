import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Snackbar,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import AppDialog from '../components/AppDialog';
import DataList from '../components/DataList';
import PageHeader from '../components/PageHeader';

export const notifyBoardsChanged = () => window.dispatchEvent(new Event('boards-changed'));

/**
 * Справочник канбан-досок: имя, поиск, 20 на страницу,
 * переход на страницу доски /boards/:id.
 */
export default function BoardsPage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [nameDlg, setNameDlg] = useState(null); // {mode:'create'|'edit', board, name}
  const [delDlg, setDelDlg] = useState(null); // board
  const [notice, setNotice] = useState('');
  const searchTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/api/boards', {
        params: { q: debounced, page: page + 1 },
      });
      setBoards(data.data ?? data);
      setTotal(data.total ?? (data.data ?? data).length);
    } catch {
      setNotice('Не удалось загрузить доски');
    }
  }, [debounced, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(0);
      setDebounced(query);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const saveName = async () => {
    const name = nameDlg.name.trim();
    if (!name) return;
    try {
      if (nameDlg.mode === 'edit') {
        await client.put(`/api/boards/${nameDlg.board.id}`, { name });
      } else {
        await client.post('/api/boards', { name });
      }
      setNameDlg(null);
      notifyBoardsChanged();
      load();
    } catch {
      setNotice('Не удалось сохранить доску');
    }
  };

  const removeBoard = async () => {
    try {
      await client.delete(`/api/boards/${delDlg.id}`);
      setDelDlg(null);
      notifyBoardsChanged();
      load();
    } catch {
      setNotice('Не удалось удалить доску');
    }
  };

  return (
    <Box>
      <PageHeader title="Доски" />
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>Все доски</Typography>
            <TextField
              size="small"
              placeholder="Поиск по доскам…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              sx={{ width: 260 }}
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
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setNameDlg({ mode: 'create', name: '' })}
            >
              Создать
            </Button>
          </Box>
          {!boards ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : boards.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              {debounced ? 'Ничего не найдено.' : 'Досок нет — создайте первую.'}
            </Typography>
          ) : (
            <DataList
              columns={[{
                key: 'name',
                label: 'Название',
                render: (b) => (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ViewKanbanIcon fontSize="small" color="action" />
                    {b.name}
                  </Box>
                ),
              }]}
              rows={boards}
              onRow={(b) => navigate(`/boards/${b.id}`)}
              actions={(b) => (
                <>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNameDlg({ mode: 'edit', board: b, name: b.name });
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDelDlg(b);
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </>
              )}
            />
          )}
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(e, p) => setPage(p)}
            rowsPerPage={20}
            rowsPerPageOptions={[20]}
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
          />
        </CardContent>
      </Card>

      <AppDialog open={!!nameDlg} onClose={() => setNameDlg(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{nameDlg?.mode === 'edit' ? 'Переименовать доску' : 'Новая доска'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Название"
            sx={{ mt: 1 }}
            autoComplete="off"
            value={nameDlg?.name ?? ''}
            onChange={(e) => setNameDlg((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNameDlg(null)}>Отмена</Button>
          <Button variant="contained" onClick={saveName} disabled={!nameDlg?.name?.trim()}>
            Сохранить
          </Button>
        </DialogActions>
      </AppDialog>

      <AppDialog open={!!delDlg} onClose={() => setDelDlg(null)} maxWidth="xs">
        <DialogTitle>Удалить доску?</DialogTitle>
        <DialogContent>
          <Typography>
            «{delDlg?.name}» будет удалена вместе со всеми колонками и задачами.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDelDlg(null)}>Отмена</Button>
          <Button color="error" variant="contained" onClick={removeBoard}>Удалить</Button>
        </DialogActions>
      </AppDialog>

      <Snackbar
        open={!!notice}
        autoHideDuration={3000}
        onClose={() => setNotice('')}
        message={notice}
      />
    </Box>
  );
}
