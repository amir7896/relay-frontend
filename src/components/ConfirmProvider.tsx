import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
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

export type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use password for sensitive values (e.g. disable 2FA). */
  inputType?: 'text' | 'password';
  maxLength?: number;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
type PromptFn = (options: PromptOptions) => Promise<string | null>;

type PendingConfirm = ConfirmOptions & {
  kind: 'confirm';
  resolve: (value: boolean) => void;
};

type PendingPrompt = PromptOptions & {
  kind: 'prompt';
  resolve: (value: string | null) => void;
};

type PendingDialog = PendingConfirm | PendingPrompt;

const ConfirmContext = createContext<ConfirmFn | null>(null);
const PromptContext = createContext<PromptFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const pendingRef = useRef<PendingDialog | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const dismiss = useCallback(() => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setPromptValue('');
    if (!current) {
      return;
    }
    if (current.kind === 'confirm') {
      current.resolve(false);
    } else {
      current.resolve(null);
    }
  }, []);

  const resolveConfirm = useCallback((value: boolean) => {
    const current = pendingRef.current;
    if (!current || current.kind !== 'confirm') {
      return;
    }
    pendingRef.current = null;
    setPending(null);
    current.resolve(value);
  }, []);

  const resolvePrompt = useCallback((value: string | null) => {
    const current = pendingRef.current;
    if (!current || current.kind !== 'prompt') {
      return;
    }
    pendingRef.current = null;
    setPending(null);
    setPromptValue('');
    current.resolve(value);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      if (pendingRef.current) {
        if (pendingRef.current.kind === 'confirm') {
          pendingRef.current.resolve(false);
        } else {
          pendingRef.current.resolve(null);
        }
      }
      const next: PendingConfirm = { ...options, kind: 'confirm', resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const prompt = useCallback<PromptFn>((options) => {
    return new Promise<string | null>((resolve) => {
      if (pendingRef.current) {
        if (pendingRef.current.kind === 'confirm') {
          pendingRef.current.resolve(false);
        } else {
          pendingRef.current.resolve(null);
        }
      }
      const next: PendingPrompt = { ...options, kind: 'prompt', resolve };
      pendingRef.current = next;
      setPromptValue(options.defaultValue ?? '');
      setPending(next);
    });
  }, []);

  useEffect(() => {
    if (!pending) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        dismiss();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pending, dismiss]);

  useEffect(() => {
    if (pending?.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [pending]);

  const confirmValue = useMemo(() => confirm, [confirm]);
  const promptValueFn = useMemo(() => prompt, [prompt]);

  function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const trimmed = promptValue.trim();
    if (!trimmed) {
      return;
    }
    resolvePrompt(trimmed);
  }

  return (
    <ConfirmContext.Provider value={confirmValue}>
      <PromptContext.Provider value={promptValueFn}>
        {children}
        {pending && typeof document !== 'undefined'
          ? createPortal(
              <div
                className="modal-backdrop confirm-backdrop"
                onClick={dismiss}
                role="presentation"
              >
                <div
                  className="modal confirm-dialog"
                  role={pending.kind === 'confirm' ? 'alertdialog' : 'dialog'}
                  aria-modal="true"
                  aria-labelledby="confirm-title"
                  aria-describedby={
                    pending.message ? 'confirm-message' : undefined
                  }
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="modal-head">
                    <h2 id="confirm-title">{pending.title}</h2>
                    <button
                      className="ghost icon-btn"
                      type="button"
                      onClick={dismiss}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  <div className="modal-body">
                    {pending.message ? (
                      <p id="confirm-message" className="muted modal-lead">
                        {pending.message}
                      </p>
                    ) : null}

                    {pending.kind === 'confirm' ? (
                      <div className="confirm-actions">
                        <button
                          className="ghost"
                          type="button"
                          onClick={() => resolveConfirm(false)}
                        >
                          {pending.cancelLabel ?? 'Cancel'}
                        </button>
                        <button
                          className={pending.danger ? 'btn danger' : 'btn'}
                          type="button"
                          autoFocus
                          onClick={() => resolveConfirm(true)}
                        >
                          {pending.confirmLabel ?? 'Confirm'}
                        </button>
                      </div>
                    ) : (
                      <form className="prompt-form" onSubmit={submitPrompt}>
                        <label className="prompt-field">
                          <span className="sr-only">{pending.title}</span>
                          <input
                            ref={inputRef}
                            type={pending.inputType ?? 'text'}
                            value={promptValue}
                            placeholder={pending.placeholder}
                            maxLength={pending.maxLength}
                            autoComplete={
                              pending.inputType === 'password'
                                ? 'current-password'
                                : 'off'
                            }
                            onChange={(event) =>
                              setPromptValue(event.target.value)
                            }
                          />
                        </label>
                        <div className="confirm-actions">
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => resolvePrompt(null)}
                          >
                            {pending.cancelLabel ?? 'Cancel'}
                          </button>
                          <button
                            className="btn"
                            type="submit"
                            disabled={!promptValue.trim()}
                          >
                            {pending.confirmLabel ?? 'OK'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </PromptContext.Provider>
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

export function usePrompt(): PromptFn {
  const prompt = useContext(PromptContext);
  if (!prompt) {
    throw new Error('usePrompt must be used within ConfirmProvider');
  }
  return prompt;
}
