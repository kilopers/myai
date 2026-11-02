import { Box, Tooltip, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';

/** HTML описания задачи → однострочный текст для превью карточки. */
const plainText = (html) => {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.trim() ?? '';
};

const fmtCreated = (s) => (s ? new Date(s).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '');

/** Иконка + счётчик без окантовки, подпись в тултипе. */
const counter = (icon, count, tip) => (
  <Tooltip title={tip} key={tip}>
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.3,
      color: 'text.secondary',
    }}
    >
      {icon}
      <Typography component="span" sx={{ fontSize: '0.7rem' }}>{count}</Typography>
    </Box>
  </Tooltip>
);

/**
 * Карточка задачи канбан-колонки: название + усечённый текст,
 * счётчики вложений/комментариев и дата создания, drag-источник
 * для переноса между колонками и внутри колонки.
 */
export default function BoardTask({ task, onClick, onDragStart }) {
  const attCount = task.attachments?.length ?? 0;
  const commentsCount = task.comments_count ?? 0;
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        {attCount > 0 && counter(
          <AttachFileIcon sx={{ fontSize: 13 }} />, attCount,
          `Прикреплённые файлы: ${attCount}`,
        )}
        {commentsCount > 0 && counter(
          <ChatBubbleOutlineOutlinedIcon sx={{ fontSize: 13 }} />, commentsCount,
          `Сообщений в обсуждении: ${commentsCount}`,
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>
          {fmtCreated(task.created_at)}
        </Typography>
      </Box>
    </Box>
  );
}
