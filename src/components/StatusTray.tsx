import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Presence, PresenceStatus } from '../api/types';
import { useChatSocket } from '../chat/ChatSocketContext';
import { initials } from '../lib/format';
import {
  clearAfterLabel,
  computeClearAt,
  formatUntilPhrase,
  inferClearOption,
  withUntilSuffix,
  type ClearAfterOption,
} from '../lib/statusClear';

type Availability = Exclude<PresenceStatus, 'offline'>;

type StatusTrayProps = {
  open: boolean;
  onClose: () => void;
  userId: string;
  handle: string;
  avatarUrl: string | null;
  onLogout: () => void;
  onPresenceChange?: (presence: Presence) => void;
};

const STATUS_PRESETS: Array<{ emoji: string; text: string }> = [
  { emoji: '🗓️', text: 'In a meeting' },
  { emoji: '🚌', text: 'Commuting' },
  { emoji: '🤒', text: 'Out sick' },
  { emoji: '🌴', text: 'Vacationing' },
  { emoji: '🏡', text: 'Working remotely' },
  { emoji: '🎧', text: 'Focusing' },
];

const EMOJI_CHOICES = [
  '🗓️',
  '🚌',
  '🤒',
  '🌴',
  '🏡',
  '🎧',
  '☕',
  '🍔',
  '✈️',
  '🐕',
  '💬',
  '🚀',
];

const AVAILABILITY: Array<{
  value: Availability;
  label: string;
  hint: string;
}> = [
  { value: 'online', label: 'Active', hint: 'Available' },
  { value: 'away', label: 'Away', hint: 'Step away' },
  { value: 'busy', label: 'Busy', hint: 'In deep work' },
  { value: 'dnd', label: 'Do not disturb', hint: 'Mute notifications' },
];

const CLEAR_OPTIONS: ClearAfterOption[] = [
  'never',
  '30m',
  '1h',
  '4h',
  'today',
];

const EMOJI_PREFIX =
  /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u;

function splitCustomStatus(raw: string | null | undefined): {
  emoji: string;
  text: string;
} {
  const value = (raw ?? '').trim();
  if (!value) return { emoji: '', text: '' };
  const match = value.match(EMOJI_PREFIX);
  if (!match) return { emoji: '', text: value };
  const emoji = match[1] ?? '';
  const text = value.slice(emoji.length).trim();
  return { emoji, text };
}

function composeCustomStatus(emoji: string, text: string): string | null {
  const combined = [emoji.trim(), text.trim()].filter(Boolean).join(' ');
  return combined ? combined.slice(0, 120) : null;
}

function availabilityLabel(status: PresenceStatus): string {
  if (status === 'away') return 'Away';
  if (status === 'busy') return 'Busy';
  if (status === 'dnd') return 'Do not disturb';
  if (status === 'offline') return 'Offline';
  return 'Active';
}

export function StatusTray({
  open,
  onClose,
  userId,
  handle,
  avatarUrl,
  onLogout,
  onPresenceChange,
}: StatusTrayProps) {
  const titleId = useId();
  const { subscribe } = useChatSocket();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState<Availability>('online');
  const [emoji, setEmoji] = useState('');
  const [text, setText] = useState('');
  const [clearAfter, setClearAfter] = useState<ClearAfterOption>('never');
  const [clearsAtLabel, setClearsAtLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);

  const applyPresence = useCallback(
    (presence: Presence) => {
      const nextStatus: Availability =
        presence.status === 'offline' ? 'online' : presence.status;
      setStatus(nextStatus);
      const split = splitCustomStatus(presence.customStatus);
      setEmoji(split.emoji);
      setText(split.text);
      const option = inferClearOption(presence.statusClearsAt);
      setClearAfter(option);
      setClearsAtLabel(
        presence.statusClearsAt
          ? formatUntilPhrase(new Date(presence.statusClearsAt))
          : null,
      );
      onPresenceChange?.(presence);
    },
    [onPresenceChange],
  );

  const patchPresence = useCallback(
    async (next: {
      status?: Availability;
      customStatus?: string | null;
      clearOption?: ClearAfterOption;
    }) => {
      setBusy(true);
      setError('');
      try {
        const clearOption = next.clearOption ?? clearAfter;
        const clearsAt =
          next.clearOption !== undefined || next.customStatus !== undefined
            ? computeClearAt(clearOption)
            : undefined;
        const body: {
          status?: Availability;
          customStatus?: string | null;
          statusClearsAt?: string | null;
        } = {};
        if (next.status !== undefined) body.status = next.status;
        if (next.customStatus !== undefined) {
          body.customStatus = next.customStatus;
        }
        if (clearsAt !== undefined) {
          body.statusClearsAt = clearsAt ? clearsAt.toISOString() : null;
        }
        const response = await api<Presence>('/chat/presence', {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        applyPresence(response.data);
        return response.data;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update status');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [applyPresence, clearAfter],
  );

  const clearStatusNow = useCallback(async () => {
    await patchPresence({
      status: 'online',
      customStatus: null,
      clearOption: 'never',
    });
  }, [patchPresence]);

  useEffect(() => {
    let cancelled = false;
    void api<Presence>(`/chat/presence/${userId}`)
      .then((response) => {
        if (!cancelled) applyPresence(response.data);
      })
      .catch(() => {
        /* ignore — tray still usable */
      });
    return () => {
      cancelled = true;
    };
  }, [userId, applyPresence]);

  useEffect(() => {
    return subscribe('chat:presence', (payload) => {
      const event = payload as Presence;
      if (event.userId !== userId) return;
      applyPresence(event);
    });
  }, [subscribe, userId, applyPresence]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setEmojiOpen(false);
      return;
    }
    const onPointer = (event: MouseEvent) => {
      const node = panelRef.current;
      if (!node) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (node.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest('.ws-rail-avatar, [aria-label="Open status menu"]')
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [open, onClose]);

  const preview = useMemo(() => {
    const custom = composeCustomStatus(emoji, text);
    return custom
      ? `${availabilityLabel(status)} · ${custom}`
      : availabilityLabel(status);
  }, [emoji, text, status]);

  const canSaveStatus = Boolean(emoji.trim() || text.trim());

  async function saveCustomStatus() {
    const trimmed = text.trim();
    if (!emoji.trim() && !trimmed) {
      setError('Add an emoji or status message before saving.');
      return;
    }
    if (trimmed.length > 100) {
      setError('Status must be 100 characters or fewer.');
      return;
    }
    setError('');
    const clearsAt = computeClearAt(clearAfter);
    const withUntil = withUntilSuffix(trimmed, clearsAt);
    try {
      await patchPresence({
        customStatus: composeCustomStatus(emoji, withUntil),
        clearOption: clearAfter,
      });
      onClose();
    } catch {
      /* error already set in patchPresence */
    }
  }

  async function pickPreset(preset: { emoji: string; text: string }) {
    setEmoji(preset.emoji);
    const clearsAt = computeClearAt(clearAfter);
    const withUntil = withUntilSuffix(preset.text, clearsAt);
    setText(withUntil);
    setError('');
    try {
      await patchPresence({
        customStatus: composeCustomStatus(preset.emoji, withUntil),
        clearOption: clearAfter === 'never' ? '1h' : clearAfter,
      });
      if (clearAfter === 'never') setClearAfter('1h');
      onClose();
    } catch {
      /* error already set in patchPresence */
    }
  }

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="status-tray-layer" role="presentation">
      <div
        ref={panelRef}
        className="status-tray"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="status-tray-head">
          <div className="status-tray-avatar-wrap">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="status-tray-avatar" />
            ) : (
              <span className="status-tray-avatar status-tray-avatar-fallback">
                {initials(handle)}
              </span>
            )}
            <span
              className={`status-tray-dot presence on presence-${status}`}
              aria-hidden="true"
            />
          </div>
          <div className="status-tray-who">
            <h2 id={titleId}>{handle}</h2>
            <p className="muted">{preview}</p>
          </div>
        </header>

        <section className="status-tray-section">
          <p className="status-tray-label">Availability</p>
          <div className="status-tray-avail" role="listbox" aria-label="Availability">
            {AVAILABILITY.map((item) => (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={status === item.value}
                className={`status-tray-avail-btn${
                  status === item.value ? ' active' : ''
                }`}
                disabled={busy}
                onClick={() => {
                  void patchPresence({ status: item.value });
                }}
              >
                <span
                  className={`status-tray-avail-dot presence on presence-${item.value}`}
                  aria-hidden="true"
                />
                <span className="status-tray-avail-copy">
                  <strong>{item.label}</strong>
                  <span className="muted">{item.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="status-tray-section">
          <p className="status-tray-label">Status</p>
          <div className="status-tray-compose">
            <div className="status-tray-emoji-wrap">
              <button
                type="button"
                className="status-tray-emoji-btn"
                aria-label="Choose emoji"
                aria-expanded={emojiOpen}
                disabled={busy}
                onClick={() => setEmojiOpen((v) => !v)}
              >
                {emoji || '☺'}
              </button>
              {emojiOpen ? (
                <div className="status-tray-emoji-grid" role="listbox">
                  {EMOJI_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className="status-tray-emoji-choice"
                      onClick={() => {
                        setEmoji(choice);
                        setEmojiOpen(false);
                      }}
                    >
                      {choice}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="status-tray-emoji-choice clear"
                    onClick={() => {
                      setEmoji('');
                      setEmojiOpen(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
            <input
              className="status-tray-input"
              value={text}
              maxLength={100}
              placeholder="What’s your status?"
              disabled={busy}
              aria-invalid={Boolean(error)}
              onChange={(event) => {
                setText(event.target.value);
                if (error) setError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveCustomStatus();
                }
              }}
            />
            <button
              type="button"
              className="btn status-tray-save"
              disabled={busy || !canSaveStatus}
              onClick={() => void saveCustomStatus()}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {error ? <p className="error status-tray-field-error">{error}</p> : null}

          <div className="status-tray-presets">
            {STATUS_PRESETS.map((preset) => (
              <button
                key={preset.text}
                type="button"
                className="status-tray-preset"
                disabled={busy}
                onClick={() => void pickPreset(preset)}
              >
                <span aria-hidden="true">{preset.emoji}</span>
                {preset.text}
              </button>
            ))}
          </div>

          <label className="status-tray-clear">
            Clear after
            <select
              value={clearAfter}
              disabled={busy}
              onChange={(event) => {
                const option = event.target.value as ClearAfterOption;
                setClearAfter(option);
                const at = computeClearAt(option);
                setClearsAtLabel(at ? formatUntilPhrase(at) : null);
              }}
            >
              {CLEAR_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {clearAfterLabel(option)}
                </option>
              ))}
            </select>
          </label>
          {clearsAtLabel && clearAfter !== 'never' ? (
            <p className="muted status-tray-clear-hint">
              Clears around {clearsAtLabel}
            </p>
          ) : null}

          {(emoji || text || status !== 'online') && (
            <button
              type="button"
              className="ghost status-tray-clear-btn"
              disabled={busy}
              onClick={() => void clearStatusNow()}
            >
              Clear status
            </button>
          )}
        </section>

        <footer className="status-tray-footer">
          <Link
            to="/profile"
            className="status-tray-link"
            onClick={onClose}
          >
            Profile &amp; preferences
          </Link>
          <button
            type="button"
            className="status-tray-link danger"
            onClick={() => {
              onClose();
              onLogout();
            }}
          >
            Sign out
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
