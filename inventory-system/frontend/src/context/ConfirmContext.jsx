import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import Modal from '../components/Modal';
import { useAuth } from './AuthContext';

const ConfirmContext = createContext(null);

/**
 * Promise-based replacement for window.confirm().
 *
 * The native dialog cannot be translated or themed, and some Android WebViews
 * suppress it entirely — which would silently skip destructive actions.
 *
 * Usage:  if (!(await confirm({ message: t('Delete category?') }))) return;
 */
export function ConfirmProvider({ children }) {
  const { t } = useAuth();
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    const config = typeof options === 'string' ? { message: options } : options;
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({
        title: config.title || null,
        message: config.message || '',
        confirmLabel: config.confirmLabel || null,
        cancelLabel: config.cancelLabel || null,
        danger: config.danger !== false,
      });
    });
  }, []);

  const settle = useCallback((result) => {
    setState(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(result);
  }, []);

  // Enter confirms, Escape cancels.
  useEffect(() => {
    if (!state) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); settle(false); }
      if (e.key === 'Enter') { e.preventDefault(); settle(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => settle(false)}
        title={state?.title || t('Please confirm')}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => settle(false)}>
              {state?.cancelLabel || t('Cancel')}
            </button>
            <button
              type="button"
              className={`btn ${state?.danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => settle(true)}
              autoFocus
            >
              {state?.confirmLabel || t('Confirm')}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>{state?.message}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

/** Returns an async confirm(message | options) => Promise<boolean>. */
export const useConfirm = () => useContext(ConfirmContext);
