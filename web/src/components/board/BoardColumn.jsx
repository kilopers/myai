import { Box, IconButton, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import BoardTask from './BoardTask';

/**
 * Колонка канбан-доски: цветной заголовок (name + color),
 * список задач, «+» для создания, drop-зона для переноса.
 */
export default function BoardColumn({
  column, onAddTask, onEditColumn, onTaskClick, onDragTaskStart, onDropTask, dragActive,
}) {
  return (
    <Box
      sx={{
        width: 264,
        flex: '0 0 auto',
        bgcolor: 'rgba(0,0,0,0.04)',
        borderRadius: 1.5,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 220px)',
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
        } : undefined}
        onDrop={dragActive ? (e) => {
          e.preventDefault();
          onDropTask(column);
        } : undefined}
        sx={{ px: 0.75, pt: 0.75, overflowY: 'auto', flexGrow: 1, minHeight: 40 }}
      >
        {(column.tasks ?? []).map((t) => (
          <BoardTask
            key={t.id}
            task={t}
            onClick={onTaskClick}
            onDragStart={onDragTaskStart}
          />
        ))}
      </Box>
      <Box sx={{ px: 0.75, pb: 0.5 }}>
        <IconButton
          size="small"
          onClick={() => onAddTask(column)}
          sx={{ color: 'text.secondary', p: 0.25 }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
