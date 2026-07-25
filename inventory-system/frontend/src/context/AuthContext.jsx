import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { settingsAPI } from '../api/client';

const AuthContext = createContext(null);

/** Offline desktop mode — no login. Provides settings, theme, and money helpers. */
export function AuthProvider({ children }) {
  const [user] = useState({
    id: 1,
    username: 'local',
    full_name: 'Local User',
    role: 'admin',
    permissions: { all: true },
  });
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    // Clear any leftover auth tokens from previous versions
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch {
      /* ignore */
    }
    settingsAPI
      .get()
      .then((res) => setSettings(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  const refreshSettings = useCallback(async () => {
    const res = await settingsAPI.get();
    setSettings(res.data.data);
    return res.data.data;
  }, []);

  const currency = settings?.currency_symbol || '₹';

  const formatMoney = useCallback(
    (n) => {
      const num = Number(n) || 0;
      return `${currency}${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    [currency]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token: null,
        settings,
        loading,
        theme,
        online,
        login: async () => user,
        logout: () => {},
        toggleTheme,
        refreshSettings,
        formatMoney,
        currency,
        isAdmin: true,
        isAuthenticated: true,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
