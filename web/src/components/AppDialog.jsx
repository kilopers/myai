import Dialog from '@mui/material/Dialog';
import useMediaQuery from '@mui/material/useMediaQuery';

/**
 * Единый диалог приложения: на мобильной (xs/sm) — полноэкранный
 * MUI fullScreen (на всю ширину и высоту), на десктопе — обычный
 * диалог. Использовать вместо прямого Dialog везде.
 */
export default function AppDialog(props) {
  const fullScreen = useMediaQuery((theme) => theme.breakpoints.down('sm'));

  return <Dialog fullWidth fullScreen={fullScreen} {...props} />;
}
