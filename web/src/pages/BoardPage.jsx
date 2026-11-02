import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Fab,
  Link,
  Tooltip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { Link as RouterLink, useParams } from 'react-router-dom';
import client from '../api/client';
import AppDialog from '../components/AppDialog';
import PageHeader from '../components/PageHeader';
import RichTextEditor from '../components/RichTextEditor';
import BoardColumn from '../components/board/BoardColumn';
import TaskAttachments from '../components/board/TaskAttachments';
import TaskComments from '../components/board/TaskComments';

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
  const taskEditorRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [{ data: boards }, { data: cols }] = await Promise.all([
        client.get('/api/boards', { params: { all: 1 } }),
        client.get('/api/board-columns', { params: { board_id: boardId } }),
      ]);
      const list = boards.data ?? boards;
      setBoard(list.find((b) => b.id === boardId) ?? { id: boardId, name: 'Доска' });
      const colsList = cols.data ?? cols;
      setColumns(colsList);
      // Открытая задача — подтягиваем свежую версию (вложения и пр.)
      setTaskDlg((d) => (d?.task
        ? { ...d, task: colsList.flatMap((c) => c.tasks).find((t) => t.id === d.task.id) ?? d.task }
        : d));
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
    // HTML берём напрямую из редактора — base64-картинки не теряются
    const liveText = taskEditorRef.current
      ? (taskEditorRef.current.isEmpty ? '' : taskEditorRef.current.getHTML())
      : null;
    const form = { ...taskDlg.form, text: liveText ?? taskDlg.form.text };
    if (!form.title.trim()) return;
    try {
      if (taskDlg.mode === 'edit') {
        await client.put(`/api/board-tasks/${taskDlg.task.id}`, form);
      } else {
        const { data: task } = await client.post('/api/board-tasks', {
          board_column_id: taskDlg.column.id, ...form,
        });
        // Отложенные вложения новой задачи — догружаем после создания
        for (const { file } of taskDlg.pending ?? []) {
          const fd = new FormData();
          fd.append('board_task_id', task.id);
          fd.append('file', file);
          await client.post('/api/board-task-attachments', fd);
        }
        (taskDlg.pending ?? []).forEach((p) => URL.revokeObjectURL(p.preview));
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

  const openTaskCreate = (column) => setTaskDlg({
    mode: 'create', column, form: { ...emptyTask }, pending: [], tab: 0,
  });
  const openTaskEdit = (task) => setTaskDlg({
    mode: 'edit', task, pending: [], tab: 0,
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
          <Link component={RouterLink} to="/boards" underline="hover" color="inherit">
            Доски
          </Link>
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

      <AppDialog open={!!colDlg} onClose={() => setColDlg(null)} maxWidth="xs" fullWidth>
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
      </AppDialog>

      <AppDialog
        open={!!taskDlg}
        onClose={() => setTaskDlg(null)}
        maxWidth="xl"
        fullWidth
        slotProps={{ paper: { sx: { height: { md: '85vh' } } } }}
      >
        <DialogTitle sx={{ pb: 0 }}>
          {taskDlg?.mode === 'edit' ? 'Задача' : 'Новая задача'}
          <Tabs
            value={taskDlg?.tab ?? 0}
            onChange={(_e, tab) => setTaskDlg((d) => ({ ...d, tab }))}
            sx={{ mt: 0.5, mb: '5px' }}
          >
            <Tab label="Описание" />
            <Tab
              label={`Обсуждение${(taskDlg?.task?.comments_count ?? taskDlg?.commentsCount ?? 0) > 0
                ? ` (${taskDlg.task?.comments_count ?? taskDlg.commentsCount})` : ''}`}
              disabled={taskDlg?.mode !== 'edit'}
            />
          </Tabs>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column' }}>
          {(taskDlg?.tab ?? 0) === 0 && (
            <>
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
              <Box sx={{ mt: 1.5 }}>
                <RichTextEditor
                  value={taskDlg?.form.text ?? ''}
                  onChange={(html) => setTaskDlg((d) => ({
                    ...d, form: { ...d.form, text: html },
                  }))}
                  placeholder="Описание задачи"
                  minHeight={200}
                  editorRef={taskEditorRef}
                />
              </Box>
              <Box sx={{ mt: 1.5 }}>
                <TaskAttachments
                  taskId={taskDlg?.mode === 'edit' ? taskDlg.task.id : null}
                  attachments={taskDlg?.task?.attachments ?? []}
                  pending={taskDlg?.pending ?? []}
                  onPending={(pending) => setTaskDlg((d) => ({ ...d, pending }))}
                  onChanged={load}
                  onError={setNotice}
                />
              </Box>
            </>
          )}
          {(taskDlg?.tab ?? 0) === 1 && taskDlg?.mode === 'edit' && (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', mt: 1 }}>
              <TaskComments
                taskId={taskDlg.task.id}
                onError={setNotice}
                onCount={(commentsCount) => setTaskDlg((d) => (d
                  ? { ...d, commentsCount, task: { ...d.task, comments_count: commentsCount } }
                  : d))}
              />
            </Box>
          )}
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
