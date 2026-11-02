import { Box, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';

/** HTML описания задачи → однострочный текст для превью карточки. */
const plainText = (html) => {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.trim() ?? '';
};

/**
 * Карточка задачи канбан-колонки: название + усечённый текст,
 * бейдж с числом вложений, drag-источник для переноса между колонками.
 */
export default function BoardTask({ task, onClick, onDragStart }) {
  const attCount = task.attachments?.length ?? 0;
  return (
    <Box
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(task);
      }}
      onClick={() => onClick(task)}
      sx={{
        bgcolor: 'background.paper',
        borderRadius: 1,
        px: 1,
        py: 0.75,
        mb: 0.75,
        cursor: 'grab',
        boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
        '&:hover': { boxShadow: '0 2px 5px rgba(0,0,0,0.2)' },
        '&:active': { cursor: 'grabbing' },
      }}
    >
      <Typography
        sx={{
          fontSize: '0.82rem',
          fontWeight: 600,
          lineHeight: 1.3,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {task.title}
      </Typography>
      {task.text ? (
        <Typography
          color="text.secondary"
          sx={{
            fontSize: '0.75rem',
            lineHeight: 1.3,
            mt: 0.25,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
          }}
        >
          {plainText(task.text)}
        </Typography>
      ) : null}
      {attCount > 0 && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.25,
          mt: 0.5, color: 'text.secondary',
        }}>
          <AttachFileIcon sx={{ fontSize: 13 }} />
          <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
            {attCount}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
