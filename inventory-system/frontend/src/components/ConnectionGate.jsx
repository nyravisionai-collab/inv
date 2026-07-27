import { useCallback, useEffect, useRef, useState } from 'react';
import { WifiOff, RotateCw } from 'lucide-react';
import { translations } from '../utils/translations';

const HEALTH_URL = '/api/health';
const CHECK_TIMEOUT_MS = 4000;
const RECHECK_INTERVAL_MS = 8000;

// This gate has to work before AuthProvider (and its translation context)
// exists — it only ever reads the already-saved UI language preference
// (not business data) so the connection screen can still show Gujarati.
function useUiLang() {
  try {
    return localStorage.getItem('lang') || 'en';
  } catch {
    return 'en';
  }
}

/**
 * Pings the backend once at startup and keeps polling while disconnected (or
 * after a previously-healthy connection drops) so nothing downstream ever
 * renders against a dead API.
 *
 * Intentionally does NOT render `children` (which includes AuthProvider and
 * therefore every page's data fetching) until the server answers. That is
 * the whole point: no cached/stale business data can ever appear when the
 * server is unreachable, because nothing that could hold or fetch business
 * data is even mounted yet.
 */
export default function ConnectionGate({ children }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'online' | 'offline'
  const timerRef = useRef(null);
  const lang = useUiLang();
  const t = (key) => translations[lang]?.[key] || translations.en[key] || key;

  const checkHealth = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      // Any HTTP response — even a non-2xx one — means the server process is
      // up and reachable; only a network error/timeout means it is not.
      await fetch(HEALTH_URL, { cache: 'no-store', signal: controller.signal });
      setStatus('online');
    } catch {
      setStatus('offline');
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (status === 'checking') return undefined;

    // Keep watching: re-check periodically while offline (to recover
    // automatically), and also once more shortly after coming online, in
    // case the server disappears mid-session (LAN Wi-Fi stays up while the
    // backend process itself is stopped).
    timerRef.current = setInterval(checkHealth, RECHECK_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [status, checkHealth]);

  useEffect(() => {
    const onFocus = () => checkHealth();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [checkHealth]);

  if (status === 'checking') {
    return (
      <div className="connection-screen">
        <div className="connection-card">
          <div className="spinner" />
          <p>{t('Connecting to server…')}</p>
        </div>
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="connection-screen">
        <div className="connection-card">
          <WifiOff size={48} />
          <h2>{t('No connection to server')}</h2>
          <p>{t('The app cannot reach the backend server on this network. No saved business data is shown until the connection is restored.')}</p>
          <button type="button" className="btn btn-primary" onClick={checkHealth}>
            <RotateCw size={16} /> {t('Retry')}
          </button>
        </div>
      </div>
    );
  }

  return children;
}
