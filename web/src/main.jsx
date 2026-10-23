import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { AuthProvider } from './context/AuthContext';
import App from './App';

// Палитра актуального GitLab: синий primary, оранжевый — только акцент бренда,
// тёмная шапка, нейтральные серые фоны. Компактная плотность.
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1068bf', contrastText: '#fff' },
    secondary: { main: '#fc6d26' },
    background: { default: '#fbfafd', paper: '#ffffff' },
    text: { primary: '#303030', secondary: '#626168' },
    divider: '#dcdcde',
    success: { main: '#217645' },
    error: { main: '#dd2b0e' },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    h5: { fontSize: '1.1rem', fontWeight: 600 },
    h6: { fontSize: '1rem', fontWeight: 600 },
    body2: { fontSize: '0.8125rem' },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundColor: '#171321', color: '#fff' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: '1px solid #dcdcde' },
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
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
    },
  },
});

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
