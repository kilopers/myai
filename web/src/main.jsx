import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import '@fontsource-variable/inter';
import { AuthProvider } from './context/AuthContext';
import App from './App';

// «Тёплый минимализм»: кремово-песочные фоны вместо стерильного
// белого, терракотовый акцент, тёплые шоколадные тона текста,
// мягкие закругления. Компактная плотность сохранена.
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#b05f38', contrastText: '#fff' },
    secondary: { main: '#8f9779' },
    background: { default: '#f6f1e8', paper: '#fffcf5' },
    text: { primary: '#3e342a', secondary: '#8a7d6b' },
    divider: '#e7dcc8',
    success: { main: '#5d8047' },
    error: { main: '#c24e32' },
  },
  shape: { borderRadius: 8 },
  typography: {
    // Self-hosted переменный Inter (один woff2 на все веса), дальше системные фолбэки.
    fontFamily: '"Inter Variable", Inter, "Inter Fallback", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    h5: { fontSize: '1.1rem', fontWeight: 600 },
    h6: { fontSize: '1rem', fontWeight: 600 },
    body2: { fontSize: '0.8125rem' },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#efe5d2',
          color: '#4a3f31',
          boxShadow: 'none',
          borderBottom: '1px solid #e2d5bd',
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: '1px solid #e7dcc8' },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 12, '&:last-child': { paddingBottom: 12 } },
      },
    },
    MuiButton: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { textTransform: 'none' } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { paddingTop: 4, paddingBottom: 4 } },
    },
    MuiTableCell: {
      styleOverrides: { root: { padding: '6px 12px' } },
    },
    MuiDialogTitle: {
      styleOverrides: {
        // На мобильной — паддинги вдвое меньше: контент ближе к краям
        root: ({ theme }) => ({
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

// PWA: регистрация service worker — приложение можно «установить»
// на домашний экран телефона. Пушей нет, SW только для installability.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
