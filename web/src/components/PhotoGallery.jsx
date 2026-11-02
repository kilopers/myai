import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import AppDialog from './AppDialog';

/**
 * Просмотрщик фотографий: полноразмерная картинка в диалоге,
 * стрелки «влево/вправо», счётчик «N из M», свайп на тачскринах.
 * `index === null` — закрыто; photos — [{url, name}].
 */
export default function PhotoGallery({ photos = [], index = null, onClose }) {
  const [current, setCurrent] = useState(0);
  const touchStart = useRef(null);

  useEffect(() => {
    if (index !== null) setCurrent(index);
  }, [index]);

  const open = index !== null && photos.length > 0;
  const photo = open ? photos[current] : null;

  const handleTouchEnd = (e) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    setCurrent(dx < 0
      ? (current + 1) % photos.length
      : (current - 1 + photos.length) % photos.length);
  };

  const navBtn = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#fff',
    bgcolor: 'rgba(0,0,0,0.45)',
    '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
  };

  return (
    <AppDialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <Box
        sx={{ position: 'relative', bgcolor: '#000' }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={handleTouchEnd}
      >
        {photo && (
          <Box
            component="img"
            src={photo.url}
            alt={photo.name}
            sx={{ display: 'block', width: '100%', maxHeight: '80vh', objectFit: 'contain' }}
          />
        )}
        <IconButton
          onClick={onClose}
          sx={{
            position: 'absolute', top: 8, right: 8, color: '#fff',
            bgcolor: 'rgba(0,0,0,0.45)', '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
          }}
        >
          <CloseIcon />
        </IconButton>
        {photos.length > 1 && (
          <>
            <IconButton
              onClick={() => setCurrent((current - 1 + photos.length) % photos.length)}
              sx={{ ...navBtn, left: 8 }}
            >
              <ChevronLeftIcon />
            </IconButton>
            <IconButton
              onClick={() => setCurrent((current + 1) % photos.length)}
              sx={{ ...navBtn, right: 8 }}
            >
              <ChevronRightIcon />
            </IconButton>
          </>
        )}
        <Chip
          label={`${current + 1} из ${photos.length}`}
          size="small"
          sx={{
            position: 'absolute', bottom: 12, left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: 'rgba(0,0,0,0.6)', color: '#fff',
          }}
        />
      </Box>
    </AppDialog>
  );
}
