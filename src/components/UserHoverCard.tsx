import {
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type {
  Conversation,
  ConversationMember,
  PresenceStatus,
  UserProfile,
} from '../api/types';
import { displayName, formatLastSeen } from '../lib/format';
import { UserAvatar } from './UserAvatar';

type Props = {
  userId: string;
  profile?: UserProfile | null;
  member?: ConversationMember | null;
  /** Bot / app messages — skip hover card. */
  isBot?: boolean;
  children: ReactNode;
  className?: string;
};

function presenceLabel(
  status: PresenceStatus | undefined,
  customStatus: string | null | undefined,
  lastSeenAt: string | null | undefined,
  showLastSeen: boolean,
): string {
  if (!status) return '';
  if (!showLastSeen && status === 'offline') {
    return customStatus?.trim() || '';
  }
  return formatLastSeen(lastSeenAt ?? null, status, customStatus);
}

export function UserHoverCard({
  userId,
  profile,
  member,
  isBot = false,
  children,
  className = '',
}: Props) {
  const navigate = useNavigate();
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [msgBusy, setMsgBusy] = useState(false);

  const clearClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  }, [clearClose]);

  const placeCard = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 300;
    const pad = 8;
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - width - pad);
    }
    if (top + 240 > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - 246);
    }
    setCoords({ top, left });
  }, []);

  const openCard = useCallback(() => {
    if (isBot) return;
    clearClose();
    placeCard();
    setOpen(true);
  }, [clearClose, isBot, placeCard]);

  async function startDm() {
    if (msgBusy) return;
    setMsgBusy(true);
    try {
      const response = await api<Conversation>('/chat/private', {
        method: 'POST',
        body: JSON.stringify({ otherUserId: userId }),
      });
      setOpen(false);
      navigate(`/chat/${response.data.id}`);
    } catch {
      // Keep card open; user can retry
    } finally {
      setMsgBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onScroll() {
      placeCard();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, placeCard]);

  useEffect(
    () => () => {
      clearClose();
    },
    [clearClose],
  );

  if (isBot) {
    return <>{children}</>;
  }

  const name = displayName(profile);
  const status = member?.status ?? 'offline';
  const statusText = presenceLabel(
    status,
    member?.customStatus,
    member?.lastSeenAt,
    profile?.showLastSeen !== false,
  );

  return (
    <span
      ref={wrapRef}
      className={`user-hover-anchor${className ? ` ${className}` : ''}`}
      onMouseEnter={openCard}
      onMouseLeave={scheduleClose}
      onFocus={openCard}
      onBlur={scheduleClose}
    >
      <button
        type="button"
        className="user-hover-trigger"
        aria-describedby={open ? tipId : undefined}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            setOpen(false);
          } else {
            openCard();
          }
        }}
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div
              id={tipId}
              role="dialog"
              aria-label={`${name} profile`}
              className="user-hover-card"
              style={{ top: coords.top, left: coords.left }}
              onMouseEnter={clearClose}
              onMouseLeave={scheduleClose}
            >
              <div className="user-hover-card-top">
                <UserAvatar profile={profile} name={name} size="lg" />
                <div className="user-hover-card-id">
                  <strong>{name}</strong>
                  {profile?.email ? (
                    <span className="muted">{profile.email}</span>
                  ) : null}
                  {statusText ? (
                    <span className={`user-hover-presence is-${status}`}>
                      <i aria-hidden="true" />
                      {statusText}
                    </span>
                  ) : null}
                </div>
              </div>
              {profile?.bio?.trim() ? (
                <p className="user-hover-bio">{profile.bio.trim()}</p>
              ) : null}
              <div className="user-hover-actions">
                <button
                  type="button"
                  className="btn user-hover-msg"
                  disabled={msgBusy}
                  onClick={() => void startDm()}
                >
                  {msgBusy ? 'Opening…' : 'Message'}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
