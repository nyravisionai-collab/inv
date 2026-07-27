import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, footer, size = '', initialFocusRef }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) {
      document.body.style.overflow = '';
      return undefined;
    }

    document.body.style.overflow = 'hidden';
    const previouslyFocused = document.activeElement;

    const focusTimer = window.setTimeout(() => {
      const target = initialFocusRef?.current
        || modalRef.current?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]');
      target?.focus?.();
    }, 0);

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal ${size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        ref={modalRef}
      >
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
