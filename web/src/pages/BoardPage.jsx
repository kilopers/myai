import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Fab,
  Link,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { Link as RouterLink, useParams } from 'react-router-dom';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import BoardColumn from '../components/board/BoardColumn';

const COLUMN_COLORS = [
  '#526de3', '#5b8ff9', '#5ad8a6', '#5d7092',
  '#f6bd16', '#e8684a', '#6dc8ec', '#9270ca',
  '#ff9d4d', '#269a99', '#ff99c3', '#a0a8bd',
];

const emptyTask = { title: '', text: '' };

/**
 * Полотно канбан-доски: колонки с цветными заголовками, задачи,
 * перенос задач между колонками drag&drop.
 */
export default function BoardPage() {
  const { id } = useParams();
  const boardId = Number(id);
  const [board, setBoard] = useState(null);
  const [columns, setColumns] = useState(null);
  const [colDlg, setColDlg] = useState(null); // {mode:'create'|'edit', column, name, color, confirmDel}
  const [taskDlg, setTaskDlg] = useState(null); // {mode:'create'|'edit', column, task, form, confirmDel}
  const [dragTask, setDragTask] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [{ data: boards }, { data: cols }] = await Promise.all([
        client.get('/api/boards', { params: { all: 1 } }),
        client.get('/api/board-columns', { params: { board_id: boardId } }),
      ]);
      const list = boards.data ?? boards;
      setBoard(list.find((b) => b.id === boardId) ?? { id: boardId, name: 'Доска' });
      setColumns(cols.data ?? cols);
    } catch {
      setNotice('Не удалось загрузить доску');
    }
  }, [boardId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveColumn = async () => {
    const name = colDlg.name.trim();
    if (!name) return;
    try {
      if (colDlg.mode === 'edit') {
        await client.put(`/api/board-columns/${colDlg.column.id}`, {
          name, color: colDlg.color,
        });
      } else {
        await client.post('/api/board-columns', {
          board_id: boardId, name, color: colDlg.color,
        });
      }
      setColDlg(null);
      load();
    } catch {
      setNotice('Не удалось сохранить колонку');
    }
  };

  const removeColumn = async () => {
    try {
      await client.delete(`/api/board-columns/${colDlg.column.id}`);
      setColDlg(null);
      load();
    } catch {
      setNotice('Не удалось удалить колонку');
    }
  };

  const saveTask = async () => {
    const form = taskDlg.form;
    if (!form.title.trim()) return;
    try {
      if (taskDlg.mode === 'edit') {
        await client.put(`/api/board-tasks/${taskDlg.task.id}`, form);
      } else {
        await client.post('/api/board-tasks', {
          board_column_id: taskDlg.column.id, ...form,
        });
      }
      setTaskDlg(null);
      load();
    } catch {
      setNotice('Не удалось сохранить задачу');
    }
  };

  const removeTask = async () => {
    try {
      await client.delete(`/api/board-tasks/${taskDlg.task.id}`);
      setTaskDlg(null);
      load();
    } catch {
      setNotice('Не удалось удалить задачу');
    }
  };

  const dropTask = async (column) => {
    const task = dragTask;
    setDragTask(null);
    if (!task || task.board_column_id === column.id) return;
    try {
      await client.put(`/api/board-tasks/${task.id}`, { board_column_id: column.id });
      load();
    } catch {
      setNotice('Не удалось перенести задачу');
    }
  };

  const openTaskCreate = (column) => setTaskDlg({ mode: 'create', column, form: { ...emptyTask } });
  const openTaskEdit = (task) => setTaskDlg({
    mode: 'edit', task,
    form: { title: task.title, text: task.text ?? '' },
  });

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      // appbar (48) + паддинги Layout main (16 xs / 24 md сверху+снизу)
      height: { xs: 'calc(100dvh - 80px)', md: 'calc(100dvh - 96px)' },
    }}>
      <PageHeader
        crumbs={(
          <>
            <Link component={RouterLink} to="/boards" underline="hover" color="inherit">
              Доски
            </Link>
            <Typography color="text.primary">{board?.name ?? '…'}</Typography>
          </>
        )}
        title={board?.name ?? '…'}
        actions={(
          <Tooltip title="Добавить колонку">
            <Fab
              size="small"
              color="primary"
              onClick={() => setColDlg({ mode: 'create', name: '', color: COLUMN_COLORS[0] })}
            >
              <AddIcon />
            </Fab>
          </Tooltip>
        )}
      />
      {!columns ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Box
          sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch', overflowX: 'auto', flex: 1, minHeight: 0, pb: 1, scrollSnapType: { xs: 'x mandatory', md: 'none' } }}
          onDragEnd={() => setDragTask(null)}
        >
          {columns.map((c) => (
            <BoardColumn
              key={c.id}
              column={c}
              dragActive={!!dragTask}
              onAddTask={openTaskCreate}
              onEditColumn={(col) => setColDlg({
                mode: 'edit', column: col, name: col.name, color: col.color,
              })}
              onTaskClick={openTaskEdit}
              onDragTaskStart={setDragTask}
              onDropTask={dropTask}
            />
          ))}
          {columns.length === 0 && (
            <Typography color="text.secondary" sx={{ py: 4 }}>
              Колонок нет — нажмите «Добавить колонку».
            </Typography>
          )}
        </Box>
      )}

      <Dialog open={!!colDlg} onClose={() => setColDlg(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {colDlg?.mode === 'edit' ? 'Колонка' : 'Новая колонка'}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Название"
            sx={{ mt: 1 }}
            autoComplete="off"
            value={colDlg?.name ?? ''}
            onChange={(e) => setColDlg((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveColumn();
            }}
          />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
            {COLUMN_COLORS.map((c) => (
              <Box
                key={c}
                onClick={() => setColDlg((d) => ({ ...d, color: c }))}
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: 1,
                  bgcolor: c,
                  cursor: 'pointer',
                  border: colDlg?.color === c ? '2px solid #000' : '2px solid transparent',
                  boxSizing: 'border-box',
                }}
              />
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {colDlg?.mode === 'edit' ? (
            colDlg.confirmDel ? (
              <Button color="error" variant="contained" onClick={removeColumn}>
                Точно удалить?
              </Button>
            ) : (
              <Button color="error" onClick={() => setColDlg((d) => ({ ...d, confirmDel: true }))}>
                Удалить
              </Button>
            )
          ) : <Box />}
          <Box>
            <Button onClick={() => setColDlg(null)}>Отмена</Button>
            <Button variant="contained" onClick={saveColumn} disabled={!colDlg?.name?.trim()}>
              Сохранить
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Dialog open={!!taskDlg} onClose={() => setTaskDlg(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {taskDlg?.mode === 'edit' ? 'Задача' : 'Новая задача'}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Название"
            sx={{ mt: 1 }}
            autoComplete="off"
            value={taskDlg?.form.title ?? ''}
            onChange={(e) => setTaskDlg((d) => ({
              ...d, form: { ...d.form, title: e.target.value },
            }))}
          />
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Текст задачи"
            sx={{ mt: 1.5 }}
            autoComplete="off"
            value={taskDlg?.form.text ?? ''}
            onChange={(e) => setTaskDlg((d) => ({
              ...d, form: { ...d.form, text: e.target.value },
            }))}
          />
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {taskDlg?.mode === 'edit' ? (
            taskDlg.confirmDel ? (
              <Button color="error" variant="contained" onClick={removeTask}>
                Точно удалить?
              </Button>
            ) : (
              <Button color="error" onClick={() => setTaskDlg((d) => ({ ...d, confirmDel: true }))}>
                Удалить
              </Button>
            )
          ) : <Box />}
          <Box>
            <Button onClick={() => setTaskDlg(null)}>Отмена</Button>
            <Button variant="contained" onClick={saveTask} disabled={!taskDlg?.form.title?.trim()}>
              Сохранить
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!notice}
        autoHideDuration={3000}
        onClose={() => setNotice('')}
        message={notice}
      />
    </Box>
  );
}
