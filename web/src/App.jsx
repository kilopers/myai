import { CircularProgress, Box } from '@mui/material';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import InviteRegisterPage from './pages/InviteRegisterPage';
import GalleryPage from './pages/GalleryPage';
import FilesPage from './pages/FilesPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import ChangePasswordPage from './pages/ChangePasswordPage';

function Protected({ children, adminOnly = false, allowPasswordChange = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!allowPasswordChange && user.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }
  if (adminOnly && !user.is_admin) return <Navigate to="/" replace />;

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InviteRegisterPage />} />
      <Route
        path="/change-password"
        element={
          <Protected allowPasswordChange>
            <ChangePasswordPage />
          </Protected>
        }
      />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<GalleryPage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/admin"
          element={
            <Protected adminOnly>
              <AdminPage />
            </Protected>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
