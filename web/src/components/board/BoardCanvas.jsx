import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import EditIcon from '@mui/icons-material/Edit';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { useSearchParams } from 'react-router-dom';
import client from '../../api/client';
import AppDialog from '../AppDialog';
import RichTextEditor from '../RichTextEditor';
import BoardColumn from './BoardColumn';
import TaskAttachments from './TaskAttachments';
import TaskComments from './TaskComments';

const COLUMN_COLORS = [
  '#526de3', '#5b8ff9', '#5ad8a6', '#5d7092',
  '#f6bd16', '#e8684a', '#6dc8ec', '#9270ca',
  '#ff9d4d', '#269a99', '#ff99c3', '#a0a8bd',
];

const emptyTask = { title: '', text: '' };

/**
 * Полотно канбан-доски: колонки, задачи, drag&drop, диалоги.
 * Одинаково работает у владельца и у гостя — разница только в
 * apiBase ('/api' или '/api/public/boards/{token}') и способе
 * загрузки (fetchData → {board, columns}).
 */
export default function BoardCanvas({
  apiBase,
  fetchData,
  header = null, // (ctx: {board, openColumnCreate}) => ReactNode
  height = { xs: 'calc(100dvh - 80px)', md: 'calc(100dvh - 96px)' },
  guestName = '',
}) {
  const [board, setBoard] = useState(null);
  const [columns, setColumns] = useState(null);
  const [colDlg, setColDlg] = useState(null); // {mode:'create'|'edit', column, name, color, confirmDel}
  const [taskDlg, setTaskDlg] = useState(null); // {mode:'create'|'edit', column, task, form, confirmDel}
  const [dragTask, setDragTask] = useState(null);
  const [moveAnchor, setMoveAnchor] = useState(null);
  const [confirmMove, setConfirmMove] = useState(null); // columnId скрытой от гостя колонки
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const taskEditorRef = useRef(null);
  // Прямая ссылка на задачу: ?task=PREFIX-N — шарится и у владельца, и у гостя.
  const [searchParams, setSearchParams] = useSearchParams();
  const taskParam = searchParams.get('task');

  const api = useCallback((path) => `${apiBase}${path}`, [apiBase]);

  const load = useCallback(async () => {
    try {
      const { board: b, columns: colsList } = await fetchData();
      setBoard(b);
      setColumns(colsList);
      // Открытая задача — подтягиваем свежую версию (вложения и пр.)
      setTaskDlg((d) => (d?.task
        ? { ...d, task: colsList.flatMap((c) => c.tasks).find((t) => t.id === d.task.id) ?? d.task }
        : d));
    } catch {
      setNotice('Не удалось загрузить доску');
    }
  }, [fetchData]);

  useEffect(() => {
    load();
  }, [load]);

  const openColumnCreate = () => setColDlg({ mode: 'create', name: '', color: COLUMN_COLORS[0] });

  const saveColumn = async () => {
    const name = colDlg.name.trim();
    if (!name) return;
    try {
      if (colDlg.mode === 'edit') {
        await client.put(api(`/board-columns/${colDlg.column.id}`), {
          name, color: colDlg.color,
          visible_guests: colDlg.visible_guests !== false,
        });
      } else {
        await client.post(api('/board-columns'), {
          name, color: colDlg.color,
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
      await client.delete(api(`/board-columns/${colDlg.column.id}`));
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
        await client.put(api(`/board-tasks/${taskDlg.task.id}`), form);
      } else {
        const { data: task } = await client.post(api('/board-tasks'), {
          board_column_id: taskDlg.column.id, ...form,
        });
        // Отложенные вложения новой задачи — догружаем после создания
        for (const { file } of taskDlg.pending ?? []) {
          const fd = new FormData();
          fd.append('board_task_id', task.id);
          fd.append('file', file);
          await client.post(api('/board-task-attachments'), fd);
        }
        (taskDlg.pending ?? []).forEach((p) => URL.revokeObjectURL(p.preview));
      }
      closeTaskDlg();
      load();
    } catch {
      setNotice('Не удалось сохранить задачу');
    }
  };

  // Точечное сохранение поля задачи + синхронизация карточки на доске
  const updateTask = async (fields) => {
    try {
      const { data: updated } = await client.put(api(`/board-tasks/${taskDlg.task.id}`), fields);
      setTaskDlg((d) => ({
        ...d,
        task: { ...d.task, ...updated },
        form: { ...d.form, ...fields },
      }));
      setColumns((cols) => cols?.map((col) => ({
        ...col,
        tasks: (col.tasks ?? []).map((t) => (t.id === taskDlg.task.id ? { ...t, ...updated } : t)),
      })));
    } catch {
      setNotice('Не удалось сохранить задачу');
    }
  };

  const saveTaskField = (fields) => {
    setTaskDlg((d) => ({ ...d, editingTitle: false }));
    if ('title' in fields && !fields.title) return; // пустой заголовок не сохраняем
    updateTask(fields);
  };

  const saveTaskText = () => {
    const html = taskEditorRef.current
      ? (taskEditorRef.current.isEmpty ? '' : taskEditorRef.current.getHTML())
      : taskDlg.task.text;
    setTaskDlg((d) => ({ ...d, editingText: false }));
    updateTask({ text: html });
  };

  const removeTask = async () => {
    try {
      await client.delete(api(`/board-tasks/${taskDlg.task.id}`));
      closeTaskDlg();
      load();
    } catch {
      setNotice('Не удалось удалить задачу');
    }
  };

  const dropTask = async (column, index = null) => {
    const task = dragTask;
    setDragTask(null);
    if (!task) return;
    if (task.board_column_id === column.id) {
      // Сортировка внутри колонки: дроп на карточку — вставка перед ней
      if (index == null) return;
      const tasks = column.tasks ?? [];
      const from = tasks.findIndex((t) => t.id === task.id);
      const to = from !== -1 && from < index ? index - 1 : index;
      if (from === -1 || to === from) return;
      const ids = tasks.map((t) => t.id).filter((id) => id !== task.id);
      ids.splice(to, 0, task.id);
      // Оптимистично переставляем карточки, откат через load() при ошибке
      setColumns((cols) => cols?.map((c) => (c.id !== column.id ? c : {
        ...c,
        tasks: ids.map((id, i) => ({ ...c.tasks.find((t) => t.id === id), position: i })),
      })));
      try {
        await client.put(api(`/board-columns/${column.id}/reorder-tasks`), { task_ids: ids });
      } catch {
        setNotice('Не удалось изменить порядок задач');
        load();
      }
      return;
    }
    try {
      await client.put(api(`/board-tasks/${task.id}`), { board_column_id: column.id });
      load();
    } catch {
      setNotice('Не удалось перенести задачу');
    }
  };

  // Перенос открытой задачи в другую колонку из диалога.
  const doMoveTask = async (columnId) => {
    const task = taskDlg?.task;
    if (!task) return;
    try {
      await client.put(api(`/board-tasks/${task.id}`), { board_column_id: columnId });
      closeTaskDlg();
      load();
    } catch {
      setNotice('Не удалось перенести задачу');
    }
  };

  // Гость → скрытая от него колонка: спрашиваем подтверждение,
  // т.к. после переноса задача пропадёт с доски.
  const moveTaskToColumn = (columnId) => {
    const task = taskDlg?.task;
    if (!task || columnId === task.board_column_id) return;
    const target = columns?.find((c) => c.id === columnId);
    if (apiBase.includes('/public/') && target?.visible_guests === false) {
      setConfirmMove(columnId);
      return;
    }
    doMoveTask(columnId);
  };

  // Возможности гостя с сервера; отсутствие настроек — всё разрешено
  // (у владельца доски поле не приходит — тоже всё разрешено).
  const caps = {
    columns: true, tasks: true, delete_tasks: true,
    edit_columns: true, delete_columns: true,
    ...(board?.guest_permissions ?? {}),
  };

  // Живой поиск: подстрока в номере PREFIX-N, названии или тексте описания.
  const q = query.trim().toLowerCase();
  const guest = apiBase.includes('/public/');
  const shownColumns = guest ? columns?.filter((c) => c.visible_guests !== false) : columns;
  const visibleColumns = q === '' ? shownColumns : shownColumns?.map((c) => ({
    ...c,
    tasks: (c.tasks ?? []).filter((t) => {
      const num = board?.prefix && t.number != null ? `${board.prefix}-${t.number}` : '';
      const text = (t.text ?? '').replace(/<[^>]*>/g, ' ');
      return [num, t.title, text]
        .some((s) => (s ?? '').toLowerCase().includes(q));
    }),
  }));

  // Ключ задачи в адресной строке: PREFIX-N (без префикса — просто N).
  const taskKey = (t) => (board?.prefix && t.number != null
    ? `${board.prefix}-${t.number}` : `${t.number}`);

  const openTaskCreate = (column) => setTaskDlg({
    mode: 'create', column, form: { ...emptyTask }, pending: [], tab: 0,
  });
  const openTaskEdit = (task) => {
    const p = new URLSearchParams(searchParams);
    p.set('task', taskKey(task));
    setSearchParams(p, { replace: true });
    setTaskDlg({
      mode: 'edit', task, pending: [], tab: 0,
      form: { title: task.title, text: task.text ?? '' },
    });
  };
  const closeTaskDlg = () => {
    setTaskDlg(null);
    const p = new URLSearchParams(searchParams);
    p.delete('task');
    setSearchParams(p, { replace: true });
  };

  // Открыли по ссылке ?task=PREFIX-N — сразу показываем диалог задачи.
  useEffect(() => {
    if (!taskParam || !columns || !board || taskDlg) return;
    const want = taskParam.toLowerCase();
    const task = columns.flatMap((c) => c.tasks ?? []).find((t) => (
      taskKey(t).toLowerCase() === want || String(t.number) === want
    ));
    if (task) openTaskEdit(task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskParam, columns, board, taskDlg]);

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      height,
      width: '100%',
    }}
    >
      {header?.({ board, openColumnCreate: caps.columns ? openColumnCreate : null, query, setQuery, caps })}
      {!columns ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Box
          sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch', overflowX: 'auto', flex: 1, minHeight: 0, pb: 1, scrollSnapType: { xs: 'x mandatory', md: 'none' } }}
          onDragEnd={() => setDragTask(null)}
        >
          {visibleColumns.map((c) => (
            <BoardColumn
              key={c.id}
              column={c}
              dragActive={!!dragTask}
              onAddTask={caps.tasks ? openTaskCreate : null}
              onEditColumn={caps.edit_columns ? (col) => setColDlg({
                mode: 'edit', column: col, name: col.name, color: col.color,
                visible_guests: col.visible_guests !== false,
              }) : null}
              onTaskClick={openTaskEdit}
              onDragTaskStart={setDragTask}
              onDropTask={dropTask}
              prefix={board?.prefix}
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
          {colDlg?.mode === 'edit' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5 }}>
              <input
                id="col-visible-guests"
                type="checkbox"
                checked={colDlg?.visible_guests !== false}
                onChange={(e) => setColDlg((d) => ({ ...d, visible_guests: e.target.checked }))}
              />
              <Typography component="label" htmlFor="col-visible-guests" variant="body2">
                Видна гостям
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {colDlg?.mode === 'edit' ? (
            !caps.delete_columns ? <Box /> : colDlg.confirmDel ? (
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
        onClose={closeTaskDlg}
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
          {(taskDlg?.tab ?? 0) === 0 && (taskDlg?.mode === 'edit' ? (
            <>
              {/* Название: текст → иконка по hover → инпут, автосохранение по blur/Enter */}
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, mt: 1,
                '&:hover .edit-btn': { opacity: 1 },
              }}
              >
                {taskDlg.editingTitle ? (
                  <TextField
                    autoFocus
                    fullWidth
                    size="small"
                    autoComplete="off"
                    defaultValue={taskDlg.task.title}
                    onBlur={(e) => saveTaskField({ title: e.target.value.trim() })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setTaskDlg((d) => ({ ...d, editingTitle: false }));
                    }}
                  />
                ) : (
                  <Typography
                    onClick={() => setTaskDlg((d) => ({ ...d, editingTitle: true }))}
                    sx={{
                      flex: 1, fontSize: '0.95rem', fontWeight: 600,
                      px: '14px', py: '8.5px', borderRadius: 1, cursor: 'text',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    {taskDlg.task.title}
                  </Typography>
                )}
                <IconButton
                  className="edit-btn"
                  size="small"
                  sx={{ opacity: 0 }}
                  onClick={() => setTaskDlg((d) => ({ ...d, editingTitle: true }))}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Box>
              {/* Описание: read-only HTML в рамке → иконка справа сверху →
                  TipTap, автосохранение при потере фокуса */}
              <Box sx={{ position: 'relative', mt: 1.5, '&:hover .edit-btn': { opacity: 1 } }}>
                {taskDlg.editingText ? (
                  <Box onBlur={(e) => {
                    // Фокус ушёл за пределы редактора (не на тулбар) — сохраняем
                    if (!e.currentTarget.contains(e.relatedTarget)) saveTaskText();
                  }}
                  >
                    <RichTextEditor
                      value={taskDlg.task.text ?? ''}
                      onChange={(html) => setTaskDlg((d) => ({
                        ...d, form: { ...d.form, text: html },
                      }))}
                      placeholder="Описание задачи"
                      minHeight={200}
                      editorRef={taskEditorRef}
                    />
                  </Box>
                ) : (
                  <Box sx={{
                    border: 1, borderColor: 'divider', borderRadius: 1,
                    px: 1.5, py: 1, minHeight: 60, fontSize: '0.875rem',
                    '& p': { m: 0, mb: 0.5 },
                    '& ul, & ol': { pl: 3, m: 0, mb: 0.5 },
                    '& blockquote': {
                      borderLeft: '3px solid', borderColor: 'divider',
                      m: 0, mb: 0.5, pl: 1.5, color: 'text.secondary',
                    },
                    '& img': { maxWidth: '100%', borderRadius: 1 },
                  }}
                  >
                    {taskDlg.task.text
                      ? <Box dangerouslySetInnerHTML={{ __html: taskDlg.task.text }} />
                      : (
                        <Typography color="text.disabled" sx={{ fontSize: '0.85rem' }}>
                          Описание отсутствует
                        </Typography>
                      )}
                  </Box>
                )}
                {!taskDlg.editingText && (
                  <IconButton
                    className="edit-btn"
                    size="small"
                    sx={{
                      position: 'absolute', top: 4, right: 4, opacity: 0,
                      bgcolor: 'background.paper', boxShadow: 1,
                    }}
                    onClick={() => setTaskDlg((d) => ({ ...d, editingText: true }))}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
              <Box sx={{ mt: 1.5 }}>
                <TaskAttachments
                  apiBase={apiBase}
                  taskId={taskDlg.task.id}
                  attachments={taskDlg?.task?.attachments ?? []}
                  pending={taskDlg?.pending ?? []}
                  onPending={(pending) => setTaskDlg((d) => ({ ...d, pending }))}
                  onChanged={load}
                  onError={setNotice}
                />
              </Box>
            </>
          ) : (
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
                  apiBase={apiBase}
                  taskId={null}
                  attachments={[]}
                  pending={taskDlg?.pending ?? []}
                  onPending={(pending) => setTaskDlg((d) => ({ ...d, pending }))}
                  onChanged={load}
                  onError={setNotice}
                />
              </Box>
            </>
          ))}
          {(taskDlg?.tab ?? 0) === 1 && taskDlg?.mode === 'edit' && (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', mt: 1 }}>
              <TaskComments
                apiBase={apiBase}
                guestName={guestName}
                taskId={taskDlg.task.id}
                onError={setNotice}
                onCount={(commentsCount) => {
                  setTaskDlg((d) => (d
                    ? { ...d, commentsCount, task: { ...d.task, comments_count: commentsCount } }
                    : d));
                  // Счётчик на карточке — сразу, без перезагрузки доски
                  setColumns((cols) => cols?.map((col) => ({
                    ...col,
                    tasks: (col.tasks ?? []).map((t) => (t.id === taskDlg.task.id
                      ? { ...t, comments_count: commentsCount } : t)),
                  })));
                }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {taskDlg?.mode === 'edit' ? (
            <Box>
              {taskDlg.confirmDel ? (
                <Button color="error" variant="contained" onClick={removeTask}>
                  Точно удалить?
                </Button>
              ) : caps.delete_tasks && (
                <Button color="error" onClick={() => setTaskDlg((d) => ({ ...d, confirmDel: true }))}>
                  Удалить
                </Button>
              )}
            </Box>
          ) : <Box />}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {taskDlg?.mode === 'edit' && columns && columns.length > 1 && (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<KeyboardArrowDownIcon />}
                  onClick={(e) => setMoveAnchor(e.currentTarget)}
                  startIcon={(
                    <Box
                      component="span"
                      sx={{
                        width: 12, height: 12, borderRadius: '50%',
                        bgcolor: columns.find((c) => c.id === taskDlg.task.board_column_id)?.color,
                      }}
                    />
                  )}
                >
                  {columns.find((c) => c.id === taskDlg.task.board_column_id)?.name}
                </Button>
                <Menu
                  anchorEl={moveAnchor}
                  open={!!moveAnchor}
                  onClose={() => setMoveAnchor(null)}
                >
                  {columns.map((c) => (
                    <MenuItem
                      key={c.id}
                      selected={c.id === taskDlg.task.board_column_id}
                      onClick={() => {
                        setMoveAnchor(null);
                        moveTaskToColumn(c.id);
                      }}
                      sx={{ gap: 1 }}
                    >
                      <Box
                        component="span"
                        sx={{
                          width: 12, height: 12, borderRadius: '50%',
                          bgcolor: c.color, flexShrink: 0,
                        }}
                      />
                      <Typography variant="body2" sx={{ flexGrow: 1 }}>{c.name}</Typography>
                      {c.id === taskDlg.task.board_column_id && (
                        <CheckIcon fontSize="small" color="primary" />
                      )}
                    </MenuItem>
                  ))}
                </Menu>
              </>
            )}
            <Button onClick={closeTaskDlg}>
              {taskDlg?.mode === 'edit' ? 'Закрыть' : 'Отмена'}
            </Button>
            {taskDlg?.mode !== 'edit' && (
              <Button variant="contained" onClick={saveTask} disabled={!taskDlg?.form.title?.trim()}>
                Создать
              </Button>
            )}
          </Box>
        </DialogActions>
      </AppDialog>

      {/* Перенос в скрытую от гостя колонку — подтверждение */}
      <AppDialog open={!!confirmMove} onClose={() => setConfirmMove(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Перенос задачи</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Вы перемещаете задачу в колонку
            «{columns?.find((c) => c.id === confirmMove)?.name}».
            После перемещения вы её больше не увидите.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmMove(null)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={() => {
              const id = confirmMove;
              setConfirmMove(null);
              doMoveTask(id);
            }}
          >
            Переместить
          </Button>
        </DialogActions>
      </AppDialog>

      <Snackbar open={!!notice} autoHideDuration={3500} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}
