import { useEffect, useState } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import BoardTask from './BoardTask';

/** Полоса-индикатор позиции вставки при drag&drop задач. */
const InsertBar = () => (
  <Box
    sx={{
      height: 3,
      borderRadius: 1.5,
      bgcolor: 'primary.main',
      mb: 0.75,
      boxShadow: '0 0 6px rgba(82,109,227,0.8)',
    }}
  />
);

/**
 * Колонка канбан-доски: цветной заголовок (name + color),
 * список задач, «+» для создания, drop-зона для переноса.
 * dropAt — позиция, куда встанет карточка (видимая полоса).
 */
export default function BoardColumn({
  column, onAddTask, onEditColumn, onTaskClick, onDragTaskStart, onDropTask, dragActive, prefix,
}) {
  const [dropAt, setDropAt] = useState(null);
  const tasks = column.tasks ?? [];

  // Перетаскивание закончилось/отменилось — убираем индикатор.
  useEffect(() => {
    if (!dragActive) setDropAt(null);
  }, [dragActive]);

  return (
    <Box
      sx={{
        // мобильная — на всю ширину (свайп между колонками),
        // десктоп — стандартная ширина канбан-колонки
        width: { xs: 'calc(100% - 8px)', md: 300 },
        flex: '0 0 auto',
        scrollSnapAlign: 'start',
        bgcolor: 'rgba(0,0,0,0.04)',
        borderRadius: 1.5,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <Box
        sx={{
          bgcolor: column.color,
          color: '#fff',
          borderRadius: '6px 6px 0 0',
          px: 1,
          py: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        <Typography
          sx={{
            fontSize: '0.82rem',
            fontWeight: 600,
            flexGrow: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {column.name}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', opacity: 0.85 }}>
          {column.tasks?.length ?? 0}
        </Typography>
        <IconButton
          size="small"
          onClick={() => onEditColumn(column)}
          sx={{ color: '#fff', p: 0.25 }}
        >
          <EditIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>
      <Box
        onDragOver={dragActive ? (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropAt(tasks.length);
        } : undefined}
        onDragLeave={(e) => {
          // Убрали курсор из зоны колонки целиком — гасим индикатор
          if (!e.currentTarget.contains(e.relatedTarget)) setDropAt(null);
        }}
        onDrop={dragActive ? (e) => {
          e.preventDefault();
          onDropTask(column, dropAt ?? tasks.length);
        } : undefined}
        sx={{ px: 0.75, pt: 0.75, overflowY: 'auto', flexGrow: 1, minHeight: 40 }}
      >
        {tasks.map((t, i) => (
          // Карточка — тоже drop-цель: дроп на карточку вставляет перед ней
          <Box
            key={t.id}
            onDragOver={dragActive ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              setDropAt(i);
            } : undefined}
            onDrop={dragActive ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onDropTask(column, i);
            } : undefined}
          >
            {dropAt === i && <InsertBar />}
            <BoardTask
              task={t}
              onClick={onTaskClick}
              onDragStart={onDragTaskStart}
              prefix={prefix}
            />
          </Box>
        ))}
        {dropAt === tasks.length && tasks.length > 0 && <InsertBar />}
        {dropAt !== null && tasks.length === 0 && <InsertBar />}
      </Box>
      {onAddTask && (
      <Box sx={{ px: 0.75, pb: 0.5 }}>
        <IconButton
          size="small"
          onClick={() => onAddTask(column)}
          sx={{
            color: '#fff',
            bgcolor: column.color,
            p: 0.25,
            '&:hover': { bgcolor: column.color, filter: 'brightness(0.88)' },
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
      )}
    </Box>
  );
}
