import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE_PARTS = [
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
];
const FOCUSABLE = FOCUSABLE_PARTS.join(', ');
// A comma-separated selector list only applies a prefix to its first entry, so
// the scoped variant has to be built part by part — otherwise
// `.modal-body button` silently matches the header close button as well.
const BODY_FOCUSABLE = FOCUSABLE_PARTS.map((part) => `.modal-body ${part}`).join(', ');

// Several modals can be open at once (a form modal plus a confirm dialog).
// Body scrolling must only be restored when the *last* one closes, so the
// count of open modals is tracked here rather than per-instance.
let openModalCount = 0;

function lockBodyScroll() {
  openModalCount += 1;
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) document.body.style.overflow = '';
}

export default function Modal({ open, onClose, title, children, footer, size = '', initialFocusRef }) {
  const modalRef = useRef(null);
  const onCloseRef = useRef(onClose);

  // Most callers pass an inline close handler. Keep the latest handler in a
  // ref so changing its identity does not tear down and recreate the modal's
  // focus effect on every form-state update (for example, every keystroke).
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    lockBodyScroll();
    const previouslyFocused = document.activeElement;

    const focusTimer = window.setTimeout(() => {
      const root = modalRef.current;
      if (!root) return;
      // React applies `autoFocus` itself while mounting. If something inside
      // the dialog already holds focus, leave it alone — moving it would undo
      // the caller's explicit choice and (when this timer lands mid-typing)
      // yank the caret out of the field the user is filling in.
      if (root.contains(document.activeElement)) return;
      const target = initialFocusRef?.current
        // Prefer a real form field in the body over the header close button.
        || root.querySelector(BODY_FOCUSABLE)
        || root.querySelector(FOCUSABLE);
      target?.focus?.();
    }, 0);

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      // Keep Tab inside the dialog so keyboard users cannot land on the page
      // behind an open modal.
      if (e.key !== 'Tab') return;
      const root = modalRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      unlockBodyScroll();
      previouslyFocused?.focus?.();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      // Close only when the press *starts* on the backdrop. Using the press
      // (not the click) still prevents a text selection that ends outside the
      // dialog from closing it and discarding a half-filled form.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCloseRef.current?.(); }}
    >
      <div
        className={`modal ${size === 'lg' ? 'modal-lg' : size === 'xl' ? 'modal-xl' : ''}`}
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
