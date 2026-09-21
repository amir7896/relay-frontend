import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type {
  Conversation,
  GlobalSearchHit,
  Paginated,
  UserProfile,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useDirectory } from '../people/DirectoryContext';
import { displayName } from '../lib/format';

type PaletteItem = {
  id: string;
  group: 'Actions' | 'Channels' | 'Direct messages' | 'People' | 'Messages';
  title: string;
  subtitle?: string;
  run: () => void;
};

function isMacPlatform() {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
  );
}

function conversationTitle(
  item: {
    type: 'private' | 'group';
    name?: string | null;
    members: Array<{ userId: string }>;
  },
  me: string | undefined,
  byUserId: Map<string, UserProfile>,
) {
  if (item.type === 'group') {
    const name = item.name?.trim() || 'Channel';
    return name.startsWith('#') ? name : `#${name}`;
  }
  const peerId = item.members.find((member) => member.userId !== me)?.userId;
  return displayName(peerId ? byUserId.get(peerId) : undefined);
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const me = session?.user.id;
  const isAdmin = session?.user.role === 'admin';
  const { byUserId, people, ensureProfiles } = useDirectory();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messageHits, setMessageHits] = useState<GlobalSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const modKey = isMacPlatform() ? '⌘' : 'Ctrl';

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    setMessageHits([]);
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery('');
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const onOpen = () => openPalette();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('relay:open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('relay:open-command-palette', onOpen);
    };
  }, [openPalette]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    void api<Paginated<Conversation>>('/chat/conversations?page=1&limit=50')
      .then((response) => {
        const items = response.data.items ?? [];
        setConversations(items);
        const ids = items.flatMap((item) =>
          item.members.map((member) => member.userId),
        );
        void ensureProfiles(ids);
      })
      .catch(() => setConversations([]));
    return () => window.clearTimeout(timer);
  }, [open, ensureProfiles]);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (term.length < 2) {
      setMessageHits([]);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void api<Paginated<GlobalSearchHit>>(
        `/chat/search?q=${encodeURIComponent(term)}&page=1&limit=12`,
      )
        .then((response) => {
          if (cancelled) return;
          setMessageHits(response.data.items ?? []);
        })
        .catch(() => {
          if (!cancelled) setMessageHits([]);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const items = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list: PaletteItem[] = [];

    const actions: PaletteItem[] = [
      {
        id: 'action-shortcuts',
        group: 'Actions',
        title: 'Keyboard shortcuts',
        subtitle: 'Jump channels, unreads, Threads, and more',
        run: () => {
          window.dispatchEvent(new CustomEvent('relay:open-shortcuts'));
        },
      },
      {
        id: 'action-status',
        group: 'Actions',
        title: 'Update your status',
        subtitle: 'Emoji, Away / DND, clear after',
        run: () => {
          window.dispatchEvent(new CustomEvent('relay:open-status'));
        },
      },
      {
        id: 'action-home',
        group: 'Actions',
        title: 'Go to Home',
        subtitle: 'Workspace welcome',
        run: () => navigate('/chat'),
      },
      {
        id: 'action-unreads',
        group: 'Actions',
        title: 'Open Unreads',
        subtitle: 'Jump to unread channels and DMs',
        run: () => {
          navigate('/chat');
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('relay:command', { detail: { action: 'unreads' } }),
            );
          }, 50);
        },
      },
      {
        id: 'action-new-channel',
        group: 'Actions',
        title: 'Create a channel',
        subtitle: 'Start a topic for your team',
        run: () => {
          navigate('/chat');
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('relay:command', { detail: { action: 'new-channel' } }),
            );
          }, 50);
        },
      },
      {
        id: 'action-new-dm',
        group: 'Actions',
        title: 'Message a teammate',
        subtitle: 'Open a direct message',
        run: () => {
          navigate('/chat');
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('relay:command', { detail: { action: 'new-dm' } }),
            );
          }, 50);
        },
      },
      {
        id: 'action-profile',
        group: 'Actions',
        title: 'Open Profile',
        subtitle: 'Status, notifications, workspace settings',
        run: () => navigate('/profile'),
      },
      {
        id: 'action-slash-remind',
        group: 'Actions',
        title: '/remind',
        subtitle: 'Remind yourself in this chat',
        run: () => {
          window.dispatchEvent(
            new CustomEvent('relay:composer-slash', {
              detail: { command: 'remind' },
            }),
          );
        },
      },
      {
        id: 'action-slash-poll',
        group: 'Actions',
        title: '/poll',
        subtitle: 'Start a poll in the open chat',
        run: () => {
          window.dispatchEvent(
            new CustomEvent('relay:composer-slash', {
              detail: { command: 'poll' },
            }),
          );
        },
      },
      {
        id: 'action-slash-assign',
        group: 'Actions',
        title: '/assign',
        subtitle: 'Assign a list task',
        run: () => {
          window.dispatchEvent(
            new CustomEvent('relay:composer-slash', {
              detail: { command: 'assign' },
            }),
          );
        },
      },
      {
        id: 'action-slash-status',
        group: 'Actions',
        title: '/status',
        subtitle: 'Set your custom status',
        run: () => {
          window.dispatchEvent(
            new CustomEvent('relay:composer-slash', {
              detail: { command: 'status' },
            }),
          );
        },
      },
      {
        id: 'action-people',
        group: 'Actions',
        title: 'Browse people',
        subtitle: isAdmin ? 'Directory' : 'Teammates',
        run: () => navigate(isAdmin ? '/people' : '/chat'),
      },
    ];
    if (isAdmin) {
      actions.push({
        id: 'action-analytics',
        group: 'Actions',
        title: 'Workspace analytics',
        subtitle: 'Messages, presence, audit',
        run: () => navigate('/analytics'),
      });
    }

    for (const action of actions) {
      if (
        !term ||
        action.title.toLowerCase().includes(term) ||
        (action.subtitle ?? '').toLowerCase().includes(term)
      ) {
        list.push(action);
      }
    }

    const channels = conversations.filter((item) => item.type === 'group');
    const dms = conversations.filter((item) => item.type === 'private');

    for (const item of channels) {
      const title = conversationTitle(item, me, byUserId);
      if (term && !title.toLowerCase().includes(term)) continue;
      list.push({
        id: `channel-${item.id}`,
        group: 'Channels',
        title,
        subtitle: item.unreadCount > 0 ? `${item.unreadCount} unread` : 'Channel',
        run: () => navigate(`/chat/${item.id}`),
      });
    }

    for (const item of dms) {
      const title = conversationTitle(item, me, byUserId);
      if (term && !title.toLowerCase().includes(term)) continue;
      list.push({
        id: `dm-${item.id}`,
        group: 'Direct messages',
        title,
        subtitle: item.unreadCount > 0 ? `${item.unreadCount} unread` : 'Direct message',
        run: () => navigate(`/chat/${item.id}`),
      });
    }

    if (term.length >= 2) {
      for (const person of people) {
        if (person.userId === me) continue;
        const name = `${person.firstName} ${person.lastName}`.trim() || person.email;
        if (
          !name.toLowerCase().includes(term) &&
          !person.email.toLowerCase().includes(term)
        ) {
          continue;
        }
        list.push({
          id: `person-${person.userId}`,
          group: 'People',
          title: name,
          subtitle: person.email,
          run: () => {
            void api<Conversation>('/chat/private', {
              method: 'POST',
              body: JSON.stringify({ userId: person.userId }),
            })
              .then((response) => navigate(`/chat/${response.data.id}`))
              .catch(() => navigate('/chat'));
          },
        });
      }
    }

    for (const hit of messageHits) {
      const channelTitle = conversationTitle(hit.conversation, me, byUserId);
      const snippet = (hit.message.body || '').trim().slice(0, 80) || 'Message';
      list.push({
        id: `msg-${hit.message.id}`,
        group: 'Messages',
        title: snippet,
        subtitle: channelTitle,
        run: () =>
          navigate(
            `/chat/${hit.conversation.id}?focus=${encodeURIComponent(hit.message.id)}`,
          ),
      });
    }

    return list;
  }, [
    query,
    conversations,
    messageHits,
    people,
    me,
    byUserId,
    navigate,
    isAdmin,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, items.length]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function runItem(item: PaletteItem) {
    close();
    item.run();
  }

  if (!open) {
    return null;
  }

  const grouped = items.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  let flatIndex = -1;

  return createPortal(
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="command-palette-search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"
            />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Jump to a channel, person, or message… (${modKey}K)`}
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const selected = items[activeIndex];
                if (selected) runItem(selected);
              }
            }}
          />
          <kbd className="command-palette-kbd">esc</kbd>
        </div>
        <div
          id="command-palette-list"
          className="command-palette-list"
          ref={listRef}
          role="listbox"
        >
          {items.length === 0 ? (
            <p className="command-palette-empty muted">
              {busy ? 'Searching…' : 'No matches. Try a channel name or message text.'}
            </p>
          ) : (
            Object.entries(grouped).map(([group, groupItems]) => (
              <div key={group} className="command-palette-group">
                <div className="command-palette-group-label">{group}</div>
                {groupItems.map((item) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const active = index === activeIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-palette-index={index}
                      className={`command-palette-item${active ? ' active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => runItem(item)}
                    >
                      <span className="command-palette-item-title">{item.title}</span>
                      {item.subtitle ? (
                        <span className="command-palette-item-sub">{item.subtitle}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="command-palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>{modKey}</kbd>
            <kbd>K</kbd> toggle
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CommandPaletteHintButton() {
  const [modKey] = useState(() => (isMacPlatform() ? '⌘' : 'Ctrl'));
  return (
    <button
      type="button"
      className="command-palette-trigger"
      title={`Open command palette (${modKey}+K)`}
      aria-label={`Open command palette (${modKey}+K)`}
      onClick={() => {
        window.dispatchEvent(new CustomEvent('relay:open-command-palette'));
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"
        />
      </svg>
      <span>Search</span>
      <kbd>{modKey}K</kbd>
    </button>
  );
}
