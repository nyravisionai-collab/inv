import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { translations } from '../utils/translations';

function useUiLang() {
  try {
    return localStorage.getItem('lang') || 'en';
  } catch {
    return 'en';
  }
}

function isStandaloneDisplay() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIosSafari() {
  const ua = window.navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  return isIos && isSafari;
}

/**
 * Surfaces the native "Install app" prompt on Android Chrome / desktop
 * Chrome & Edge, and a plain instruction banner on iOS Safari (which never
 * fires beforeinstallprompt). Purely a UI affordance — holds no business
 * data, and the dismiss flag lives in sessionStorage so it resets the next
 * time the app is opened.
 */
export default function InstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState(null);
  const [installed, setInstalled] = useState(isStandaloneDisplay());
  const [dismissedAndroid, setDismissedAndroid] = useState(false);
  const [dismissedIos, setDismissedIos] = useState(() => {
    try {
      return sessionStorage.getItem('installHintDismissed') === '1';
    } catch {
      return false;
    }
  });
  const lang = useUiLang();
  const t = (key) => translations[lang]?.[key] || translations.en[key] || key;

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredEvent(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleInstallClick = async () => {
    if (!deferredEvent) return;
    deferredEvent.prompt();
    try {
      await deferredEvent.userChoice;
    } catch {
      /* ignore */
    } finally {
      setDeferredEvent(null);
    }
  };

  const dismissIosHint = () => {
    setDismissedIos(true);
    try {
      sessionStorage.setItem('installHintDismissed', '1');
    } catch {
      /* ignore */
    }
  };

  if (deferredEvent && !dismissedAndroid) {
    return (
      <div className="install-banner">
        <Download size={18} />
        <span>{t('Install this app for quick offline access')}</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={handleInstallClick}>
          {t('Install app')}
        </button>
        <button
          type="button"
          className="btn-icon install-banner-dismiss"
          onClick={() => setDismissedAndroid(true)}
          aria-label={t('Dismiss')}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  if (isIosSafari() && !dismissedIos) {
    return (
      <div className="install-banner">
        <Share size={18} />
        <span>{t('To install: tap Share, then "Add to Home Screen"')}</span>
        <button type="button" className="btn-icon install-banner-dismiss" onClick={dismissIosHint} aria-label={t('Dismiss')}>
          <X size={16} />
        </button>
      </div>
    );
  }

  return null;
}
