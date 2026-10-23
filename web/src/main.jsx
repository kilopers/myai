import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { AuthProvider } from './context/AuthContext';
import App from './App';

// GitLab-inspired palette: фиолетовый primary, оранжевый accent, светлый фон.
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#7759c2', contrastText: '#fff' },
    secondary: { main: '#fc6d26' },
    background: { default: '#fbfafd', paper: '#ffffff' },
    text: { primary: '#303030', secondary: '#626168' },
    divider: '#dbdbdb',
    success: { main: '#217645' },
    error: { main: '#dd2b0e' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"GitLab Sans", -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundColor: '#292961', color: '#fff' },
      },
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
