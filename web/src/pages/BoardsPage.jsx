import { useCallback, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import AppDialog from '../components/AppDialog';
import PageHeader from '../components/PageHeader';
import Reference from '../components/Reference';

export const notifyBoardsChanged = () => window.dispatchEvent(new Event('boards-changed'));

/**
 * Справочник канбан-досок на едином Reference: поиск, пагинация
 * (20/стр), переход на страницу доски /boards/:id по клику строки.
 */
export default function BoardsPage() {
  const navigate = useNavigate();
  const [refKey, setRefKey] = useState(0);
  const [nameDlg, setNameDlg] = useState(null); // {mode:'create'|'edit', board, name}
  const [delDlg, setDelDlg] = useState(null); // board
  const [notice, setNotice] = useState('');

  const fetchBoards = useCallback(async ({ q, page }) => {
    const { data } = await client.get('/api/boards', {
      params: { q: q ?? '', page },
    });
    return { data: data.data ?? data, total: data.total ?? (data.data ?? data).length };
  }, []);

  const saveName = async () => {
    const name = nameDlg.name.trim();
    if (!name) return;
    const payload = { name, prefix: nameDlg.prefix?.trim() || null };
    try {
      if (nameDlg.mode === 'edit') {
        await client.put(`/api/boards/${nameDlg.board.id}`, payload);
      } else {
        await client.post('/api/boards', payload);
      }
      setNameDlg(null);
      notifyBoardsChanged();
      setRefKey((k) => k + 1);
    } catch {
      setNotice('Не удалось сохранить доску');
    }
  };

  const removeBoard = async () => {
    try {
      await client.delete(`/api/boards/${delDlg.id}`);
      setDelDlg(null);
      notifyBoardsChanged();
      setRefKey((k) => k + 1);
    } catch {
      setNotice('Не удалось удалить доску');
    }
  };

  return (
    <Box>
      <PageHeader title="Доски" />
      <Card>
        <CardContent>
          <Reference
            meta={{
              label: 'Все доски',
              addLabel: 'Создать',
              columns: [{
                key: 'name',
                label: 'Название',
                render: (b) => (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ViewKanbanIcon fontSize="small" color="action" />
                    {b.name}
                  </Box>
                ),
              }],
              filters: [{ name: 'q', label: 'Поиск по доскам', type: 'text' }],
              can: { create: true, edit: true, delete: true },
            }}
            fetch={fetchBoards}
            onAdd={() => setNameDlg({ mode: 'create', name: '', prefix: '' })}
            onEdit={(b) => setNameDlg({ mode: 'edit', board: b, name: b.name, prefix: b.prefix ?? '' })}
            onDelete={(b) => setDelDlg(b)}
            onRow={(b) => navigate(`/boards/${b.id}`)}
            refreshKey={refKey}
            empty="Досок нет — создайте первую."
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
          <TextField
            size="small"
            label="Префикс задач"
            placeholder="Например: PROJ"
            helperText="Только латинские заглавные — номера карточек PREFIX-1, PREFIX-2…"
            sx={{ mt: 1.5 }}
            autoComplete="off"
            value={nameDlg?.prefix ?? ''}
            onChange={(e) => setNameDlg((d) => ({
              ...d,
              prefix: e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 10),
            }))}
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
