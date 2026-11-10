import { alpha, createTheme } from '@mui/material';

// «Премиум-лайт»: чистый светлый холст с лёгким холодным оттенком,
// глубокий индиго-акцент, мягкие многослойные тени, стеклянная шапка,
// аккуратные скругления и выверенная типографика Inter.
const ink = '#0f172a';
const muted = '#64748b';
const line = '#e6e8f0';
const primary = '#4f46e5';

const shadows = [
  'none',
  '0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03)',
  '0 1px 3px rgba(15,23,42,.06), 0 1px 2px rgba(15,23,42,.04)',
  '0 4px 12px -2px rgba(15,23,42,.06), 0 2px 4px -2px rgba(15,23,42,.04)',
  '0 8px 20px -4px rgba(15,23,42,.08), 0 3px 6px -3px rgba(15,23,42,.05)',
  '0 12px 28px -6px rgba(15,23,42,.10), 0 4px 8px -4px rgba(15,23,42,.05)',
];
while (shadows.length < 25) shadows.push('0 24px 48px -12px rgba(15,23,42,.18), 0 8px 16px -8px rgba(15,23,42,.08)');

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: primary, light: '#818cf8', dark: '#4338ca', contrastText: '#fff' },
    secondary: { main: '#0ea5e9' },
    background: { default: '#f7f8fb', paper: '#ffffff' },
    text: { primary: ink, secondary: muted },
    divider: line,
    success: { main: '#10b981' },
    warning: { main: '#f59e0b' },
    error: { main: '#ef4444' },
    info: { main: '#3b82f6' },
    action: { hover: alpha(primary, 0.05), selected: alpha(primary, 0.09) },
  },
  shape: { borderRadius: 10 },
  shadows,
  typography: {
    fontFamily: '"Inter Variable", Inter, "Inter Fallback", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontSize: '1.15rem', fontWeight: 650, letterSpacing: '-0.015em' },
    h6: { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle2: { fontWeight: 600 },
    body2: { fontSize: '0.8125rem' },
    button: { fontWeight: 550, letterSpacing: 0 },
    overline: { fontWeight: 600, letterSpacing: '0.08em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          fontFeatureSettings: '"cv11", "ss01"',
          backgroundImage: `radial-gradient(1200px 600px at 100% -10%, ${alpha(primary, 0.06)}, transparent 60%), radial-gradient(900px 500px at -10% 110%, ${alpha('#0ea5e9', 0.05)}, transparent 60%)`,
          backgroundAttachment: 'fixed',
        },
        '::selection': { background: alpha(primary, 0.18) },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': { background: '#d5d9e4', borderRadius: 10, border: '3px solid transparent', backgroundClip: 'content-box' },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: alpha('#ffffff', 0.78),
          backdropFilter: 'saturate(180%) blur(14px)',
          color: ink,
          borderBottom: `1px solid ${line}`,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: { paper: { borderRight: `1px solid ${line}`, backgroundColor: '#fbfbfd' } },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: line } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${line}`,
          boxShadow: shadows[1],
          transition: 'box-shadow .2s ease, border-color .2s ease, transform .2s ease',
        },
      },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 14, '&:last-child': { paddingBottom: 14 } } },
    },
    MuiButton: {
      defaultProps: { size: 'small', disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 8, transition: 'all .15s ease' },
        containedPrimary: {
          backgroundImage: `linear-gradient(180deg, #5b54ea 0%, ${primary} 100%)`,
          boxShadow: `0 1px 2px rgba(15,23,42,.1), inset 0 1px 0 ${alpha('#fff', 0.15)}`,
          '&:hover': { boxShadow: `0 6px 16px -4px ${alpha(primary, 0.45)}` },
        },
        outlined: { borderColor: line, '&:hover': { borderColor: alpha(primary, 0.5), backgroundColor: alpha(primary, 0.04) } },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 8, '&:hover': { backgroundColor: alpha(primary, 0.06) } } },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          paddingTop: 4,
          paddingBottom: 4,
          borderRadius: 8,
          '&.Mui-selected': {
            backgroundColor: alpha(primary, 0.08),
            color: primary,
            '& .MuiListItemIcon-root': { color: primary },
            '&:hover': { backgroundColor: alpha(primary, 0.12) },
          },
        },
      },
    },
    MuiListItemIcon: { styleOverrides: { root: { minWidth: 36, color: muted } } },
    MuiTableCell: {
      styleOverrides: {
        root: { padding: '8px 12px', borderColor: line },
        head: { fontWeight: 600, color: muted, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', backgroundColor: '#fafbfc' },
      },
    },
    MuiTableRow: {
      styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: alpha(primary, 0.03) } } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: '#fff',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: line },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#c7cbe0' },
          '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(primary, 0.12)}` },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 6, fontWeight: 500 } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: ink, fontSize: '0.75rem', borderRadius: 6, padding: '6px 10px' },
        arrow: { color: ink },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16, boxShadow: shadows[24] },
      },
    },
    MuiBackdrop: {
      styleOverrides: { root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: alpha(ink, 0.35), backdropFilter: 'blur(3px)' } } },
    },
    MuiMenu: {
      styleOverrides: { paper: { borderRadius: 10, border: `1px solid ${line}`, boxShadow: shadows[5] } },
    },
    MuiTabs: {
      styleOverrides: { indicator: { height: 2.5, borderRadius: 2 } },
    },
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 550, minHeight: 44 } },
    },
    MuiDialogTitle: {
      styleOverrides: {
        // На мобильной — паддинги вдвое меньше: контент ближе к краям
        root: ({ theme }) => ({
          fontWeight: 650,
          letterSpacing: '-0.01em',
          [theme.breakpoints.down('sm')]: { padding: '8px 12px' },
        }),
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: ({ theme }) => ({
          '.MuiDialogTitle-root + &': { paddingTop: 6 },
          [theme.breakpoints.down('sm')]: { padding: '10px 12px' },
        }),
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
    },
  },
});

export default theme;
