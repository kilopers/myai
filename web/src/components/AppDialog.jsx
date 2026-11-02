import Dialog from '@mui/material/Dialog';

/**
 * Единый диалог приложения: на мобильной (xs) почти на весь экран
 * (по 2px слева/справа, до 32px сверху/снизу), на десктопе —
 * обычный MUI Dialog. Использовать вместо прямого Dialog везде.
 */
export default function AppDialog({ sx, ...props }) {
  return (
    <Dialog
      fullWidth
      {...props}
      sx={{
        '& .MuiDialog-container > .MuiDialog-paper': {
          xs: {
            width: 'calc(100% - 4px)',
            maxWidth: 'calc(100% - 4px)',
            m: '2px',
            maxHeight: 'calc(100% - 32px)',
          },
        },
        ...sx,
      }}
    />
  );
}
