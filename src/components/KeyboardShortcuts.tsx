import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  SHORTCUTS,
  dispatchShortcutAction,
  matchShortcut,
  modSymbol,
  type ShortcutDef,
} from '../lib/shortcuts';

const GROUPS: Array<ShortcutDef['group']> = [
  'Navigation',
  'Messaging',
  'Views',
  'General',
];

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const mod = modSymbol();

  const close = useCallback(() => setOpen(false), []);

  const grouped = useMemo(() => {
    return GROUPS.map((group) => ({
      group,
      items: SHORTCUTS.filter((item) => item.group === group).map((item) => {
        // Recompute display keys so mod symbol matches current platform
        if (item.action === 'open-shortcuts') {
          return { ...item, keys: [mod, '/'] };
        }
        if (item.action === 'open-palette') {
          return { ...item, keys: [mod, 'K'] };
        }
        if (
          item.action === 'open-unreads' ||
          item.action === 'open-threads' ||
          item.action === 'open-later' ||
          item.action === 'open-activity' ||
          item.action === 'open-drafts'
        ) {
          const letter = item.keys[item.keys.length - 1]!;
          return { ...item, keys: [mod, '⇧', letter] };
        }
        return item;
      }),
    })).filter((section) => section.items.length > 0);
  }, [mod]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('relay:open-shortcuts', onOpen);
    return () => window.removeEventListener('relay:open-shortcuts', onOpen);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hit = matchShortcut(event);
      if (!hit) return;

      // Command palette owns ⌘K itself — avoid double-toggle.
      if (hit.action === 'open-palette') return;

      if (hit.action === 'open-shortcuts') {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      if (open) return;

      event.preventDefault();
      dispatchShortcutAction(hit.action);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="shortcuts-backdrop"
      role="presentation"
      onClick={close}
    >
      <div
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shortcuts-head">
          <div>
            <h2 id="shortcuts-title">Keyboard shortcuts</h2>
            <p className="muted shortcuts-sub">
              Press <kbd>?</kbd> or <kbd>{mod}</kbd>
              <kbd>/</kbd> anytime
            </p>
          </div>
          <button
            type="button"
            className="ghost icon-btn"
            aria-label="Close"
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="shortcuts-body">
          {grouped.map((section) => (
            <section key={section.group} className="shortcuts-group">
              <h3>{section.group}</h3>
              <ul>
                {section.items.map((item) => (
                  <li key={item.id}>
                    <span className="shortcuts-label">{item.label}</span>
                    <span className="shortcuts-keys" aria-hidden="true">
                      {item.keys.map((key) => (
                        <kbd key={`${item.id}-${key}`}>{key}</kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
