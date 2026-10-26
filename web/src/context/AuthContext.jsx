import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import client, { clearToken, getToken, setToken } from '../api/client';
import { wsConnect, wsDisconnect } from '../api/ws';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    client
      .get('/api/auth/me')
      .then(({ data }) => setUser(data))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  // Живое обновление: ws-канал sync.user.<id> живёт пока залогинен.
  useEffect(() => {
    if (user?.id) wsConnect(user.id);
    else wsDisconnect();
  }, [user?.id]);

  const login = useCallback(async (email, password) => {
    const { data } = await client.post('/api/auth/login', { email, password });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await client.post('/api/auth/logout');
    } finally {
      clearToken();
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
