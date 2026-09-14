import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

type PendingConfirm = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const close = useCallback((value: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      if (pendingRef.current) {
        pendingRef.current.resolve(false);
      }
      const next: PendingConfirm = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  useEffect(() => {
    if (!pending) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pending, close]);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="modal-backdrop confirm-backdrop"
              onClick={() => close(false)}
              role="presentation"
            >
              <div
                className="modal confirm-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-title"
                aria-describedby="confirm-message"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-head">
                  <h2 id="confirm-title">{pending.title}</h2>
                  <button
                    className="ghost icon-btn"
                    type="button"
                    onClick={() => close(false)}
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <div className="modal-body">
                  <p id="confirm-message" className="muted modal-lead">
                    {pending.message}
                  </p>
                  <div className="confirm-actions">
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => close(false)}
                    >
                      {pending.cancelLabel ?? 'Cancel'}
                    </button>
                    <button
                      className={pending.danger ? 'btn danger' : 'btn'}
                      type="button"
                      autoFocus
                      onClick={() => close(true)}
                    >
                      {pending.confirmLabel ?? 'Confirm'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return confirm;
}
