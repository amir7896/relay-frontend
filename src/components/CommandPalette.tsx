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

type AskCitation = {
  messageId: string;
  conversationId: string;
  conversationName: string | null;
  conversationType: 'private' | 'group';
  bodySnippet: string;
  createdAt: string;
};

type AskResult = {
  answer: string;
  poweredByAi: boolean;
  demoMode?: boolean;
  citations: AskCitation[];
};

type DigestSection = {
  conversationId: string;
  conversationName: string;
  conversationType: 'private' | 'group';
  unreadCount: number;
  summary: string;
  firstUnreadMessageId: string | null;
  deepLink: string;
};

type DigestResult = {
  generatedAt: string;
  poweredByAi: boolean;
  overview: string;
  sections: DigestSection[];
};

type PaletteItem = {
  id: string;
  group:
    | 'Actions'
    | 'Ask Relay'
    | 'Channels'
    | 'Direct messages'
    | 'People'
    | 'Messages';
  title: string;
  subtitle?: string;
  run: () => void;
};

function parseAskQuery(raw: string): { isAsk: boolean; question: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('?')) {
    return { isAsk: true, question: trimmed.replace(/^\?+\s*/, '').trim() };
  }
  const askPrefix = trimmed.match(/^ask\s*:\s*(.+)$/i);
  if (askPrefix) {
    return { isAsk: true, question: askPrefix[1].trim() };
  }
  return { isAsk: false, question: trimmed };
}

function stripAskPrefix(raw: string): string {
  return parseAskQuery(raw).question;
}

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
  const [mode, setMode] = useState<'search' | 'ask'>('search');
  const [activeIndex, setActiveIndex] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messageHits, setMessageHits] = useState<GlobalSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);
  const [digestResult, setDigestResult] = useState<DigestResult | null>(null);
  const [digestError, setDigestError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const digestPendingRef = useRef(false);
  const modKey = isMacPlatform() ? '⌘' : 'Ctrl';

  const questionText = stripAskPrefix(query);
  const isAskMode = mode === 'ask';

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setMode('search');
    setActiveIndex(0);
    setMessageHits([]);
    setAskResult(null);
    setAskError('');
    setAskBusy(false);
    setDigestResult(null);
    setDigestError('');
    setDigestBusy(false);
    digestPendingRef.current = false;
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery('');
    setMode('search');
    setActiveIndex(0);
  }, []);

  const runDailyDigest = useCallback(async () => {
    if (digestBusy) return;
    setDigestBusy(true);
    setDigestError('');
    setAskResult(null);
    setAskError('');
    try {
      const response = await api<DigestResult>('/chat/digest', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setDigestResult(response.data);
    } catch (err) {
      setDigestResult(null);
      setDigestError(
        err instanceof Error ? err.message : 'Daily digest failed',
      );
    } finally {
      setDigestBusy(false);
    }
  }, [digestBusy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const onOpen = () => openPalette();
    const onDigest = () => {
      digestPendingRef.current = true;
      openPalette();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('relay:open-command-palette', onOpen);
    window.addEventListener('relay:open-daily-digest', onDigest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('relay:open-command-palette', onOpen);
      window.removeEventListener('relay:open-daily-digest', onDigest);
    };
  }, [openPalette]);

  useEffect(() => {
    if (!open || !digestPendingRef.current) return;
    digestPendingRef.current = false;
    void runDailyDigest();
  }, [open, runDailyDigest]);

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
    // Legacy "? question" typing still flips into Ask mode.
    if (parseAskQuery(query).isAsk) {
      setMode('ask');
    }
    if (mode === 'ask') {
      setMessageHits([]);
      setBusy(false);
      return;
    }
    setAskResult(null);
    setAskError('');
    setAskBusy(false);
    const term = stripAskPrefix(query).trim();
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
  }, [open, query, mode]);

  const runAskRelay = useCallback(
    async (question: string) => {
      const cleaned = question.trim();
      if (cleaned.length < 3 || askBusy) return;
      setAskBusy(true);
      setAskError('');
      setDigestResult(null);
      setDigestError('');
      try {
        const response = await api<AskResult>('/chat/ask', {
          method: 'POST',
          body: JSON.stringify({ question: cleaned }),
        });
        setAskResult(response.data);
      } catch (err) {
        setAskResult(null);
        setAskError(
          err instanceof Error ? err.message : 'Ask Relay failed',
        );
      } finally {
        setAskBusy(false);
      }
    },
    [askBusy],
  );

  const items = useMemo(() => {
    const question = questionText.trim();
    const term = isAskMode ? '' : question.toLowerCase();
    const list: PaletteItem[] = [];

    if (question.length >= 3) {
      list.push({
        id: 'ask-relay-run',
        group: 'Ask Relay',
        title: askBusy
          ? 'Asking…'
          : isAskMode
            ? `Ask: ${question}`
            : `Ask Relay: ${question}`,
        subtitle: askBusy
          ? 'Searching messages and summarizing'
          : 'AI answer grounded in your chat history — click or press Enter',
        run: () => {
          setMode('ask');
          void runAskRelay(question);
        },
      });
    }

    if (isAskMode) {
      if (list.length === 0) {
        list.push({
          id: 'ask-relay-hint',
          group: 'Ask Relay',
          title: 'Type a question above',
          subtitle: 'Example: What channels do I have?',
          run: () => inputRef.current?.focus(),
        });
      }
      list.push({
        id: 'action-daily-digest',
        group: 'Actions',
        title: digestBusy ? 'Generating digest…' : 'Daily digest',
        subtitle: digestBusy
          ? 'Summarizing unread channels and DMs'
          : 'Morning catch-up across unread conversations',
        run: () => {
          void runDailyDigest();
        },
      });
      return list;
    }

    const actions: PaletteItem[] = [
      {
        id: 'action-ask-mode',
        group: 'Actions',
        title: 'Ask Relay',
        subtitle: 'Ask AI about your workspace chat',
        run: () => {
          setMode('ask');
          window.setTimeout(() => inputRef.current?.focus(), 20);
        },
      },
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
        id: 'action-daily-digest',
        group: 'Actions',
        title: digestBusy ? 'Generating digest…' : 'Daily digest',
        subtitle: digestBusy
          ? 'Summarizing unread channels and DMs'
          : 'Morning catch-up across unread conversations',
        run: () => {
          void runDailyDigest();
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
    questionText,
    isAskMode,
    conversations,
    messageHits,
    people,
    me,
    byUserId,
    navigate,
    isAdmin,
    askBusy,
    runAskRelay,
    digestBusy,
    runDailyDigest,
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
    if (
      item.id === 'ask-relay-run' ||
      item.id === 'ask-relay-hint' ||
      item.id === 'action-daily-digest' ||
      item.id === 'action-ask-mode'
    ) {
      item.run();
      return;
    }
    close();
    item.run();
  }

  if (!open) {
    return null;
  }

  const canAsk = questionText.trim().length >= 3;
  const showAskPanel = isAskMode || askBusy || Boolean(askResult) || Boolean(askError);
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
        <div className="command-palette-modes" role="tablist" aria-label="Palette mode">
          <button
            type="button"
            role="tab"
            aria-selected={!isAskMode}
            className={`command-palette-mode${!isAskMode ? ' is-active' : ''}`}
            onClick={() => {
              setMode('search');
              setAskResult(null);
              setAskError('');
              window.setTimeout(() => inputRef.current?.focus(), 20);
            }}
          >
            Search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isAskMode}
            className={`command-palette-mode${isAskMode ? ' is-active' : ''}`}
            onClick={() => {
              setMode('ask');
              window.setTimeout(() => inputRef.current?.focus(), 20);
            }}
          >
            Ask Relay
          </button>
        </div>
        <div className="command-palette-search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            {isAskMode ? (
              <path
                fill="currentColor"
                d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7zm-1 18h2v1h-2v-1z"
              />
            ) : (
              <path
                fill="currentColor"
                d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"
              />
            )}
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              isAskMode
                ? 'Ask anything about your workspace…'
                : `Search channels, people, messages… (${modKey}K)`
            }
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((i) =>
                  Math.min(i + 1, Math.max(items.length - 1, 0)),
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (isAskMode && canAsk) {
                  void runAskRelay(questionText.trim());
                  return;
                }
                const selected = items[activeIndex];
                if (selected) runItem(selected);
              }
            }}
          />
          {isAskMode && canAsk ? (
            <button
              type="button"
              className="btn command-palette-ask-btn"
              disabled={askBusy}
              onClick={() => void runAskRelay(questionText.trim())}
            >
              {askBusy ? 'Asking…' : 'Ask'}
            </button>
          ) : (
            <kbd className="command-palette-kbd">esc</kbd>
          )}
        </div>
        {showAskPanel ? (
          <div className="command-palette-ask" aria-live="polite">
            {askBusy ? (
              <p className="muted">Searching messages and writing an answer…</p>
            ) : null}
            {askError ? <p className="error">{askError}</p> : null}
            {askResult ? (
              <>
                <div className="command-palette-ask-head">
                  <strong>Ask Relay</strong>
                  <span className="muted">
                    {askResult.demoMode
                      ? 'Demo AI · grounded citations'
                      : askResult.poweredByAi
                        ? 'AI · grounded citations'
                        : 'Local matches'}
                  </span>
                </div>
                <pre className="command-palette-ask-answer">{askResult.answer}</pre>
                {askResult.citations.length > 0 ? (
                  <div className="command-palette-ask-citations">
                    {askResult.citations.map((citation, index) => {
                      const label = citation.conversationName
                        ? `#${citation.conversationName.replace(/^#/, '')}`
                        : citation.conversationType === 'group'
                          ? '#channel'
                          : 'DM';
                      return (
                        <button
                          key={`${citation.messageId}-${index}`}
                          type="button"
                          className="command-palette-citation"
                          title={citation.bodySnippet}
                          onClick={() => {
                            close();
                            navigate(
                              `/chat/${citation.conversationId}?focus=${encodeURIComponent(citation.messageId)}`,
                            );
                          }}
                        >
                          <span className="command-palette-citation-idx">
                            {index + 1}
                          </span>
                          <span className="command-palette-citation-copy">
                            <strong>{label}</strong>
                            <small>{citation.bodySnippet}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : !askBusy && !askError && isAskMode ? (
              <p className="muted">
                {canAsk
                  ? 'Press Enter or click Ask.'
                  : 'Type a question (at least a few words), then press Enter.'}
              </p>
            ) : null}
          </div>
        ) : null}
        {digestBusy || digestResult || digestError ? (
          <div className="command-palette-digest" aria-live="polite">
            {digestBusy ? (
              <p className="muted">Scanning unread channels and writing your digest…</p>
            ) : null}
            {digestError ? <p className="error">{digestError}</p> : null}
            {digestResult ? (
              <>
                <div className="command-palette-digest-head">
                  <strong>Daily digest</strong>
                  <span className="muted">
                    {digestResult.poweredByAi
                      ? 'AI · unread catch-up'
                      : 'Unread catch-up'}
                  </span>
                </div>
                <pre className="command-palette-digest-overview">
                  {digestResult.overview}
                </pre>
                {digestResult.sections.length > 0 ? (
                  <div className="command-palette-digest-sections">
                    {digestResult.sections.map((section) => (
                      <button
                        key={section.conversationId}
                        type="button"
                        className="command-palette-digest-section"
                        title={section.summary}
                        onClick={() => {
                          close();
                          navigate(section.deepLink);
                        }}
                      >
                        <span className="command-palette-digest-section-meta">
                          <strong>{section.conversationName}</strong>
                          <span className="muted">
                            {section.unreadCount} unread
                          </span>
                        </span>
                        <small>{section.summary}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Nothing unread to open.</p>
                )}
              </>
            ) : null}
          </div>
        ) : null}
        <div
          id="command-palette-list"
          className="command-palette-list"
          ref={listRef}
          role="listbox"
        >
          {items.length === 0 ? (
            <p className="command-palette-empty muted">
              {busy
                ? 'Searching…'
                : isAskMode
                  ? 'Type a question, then press Enter or click Ask.'
                  : 'No matches. Try a channel name, or switch to Ask Relay.'}
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
                      <span className="command-palette-item-title">
                        {item.title}
                      </span>
                      {item.subtitle ? (
                        <span className="command-palette-item-sub">
                          {item.subtitle}
                        </span>
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
            <kbd>↵</kbd> {isAskMode ? 'ask' : 'open'}
          </span>
          <span>Use the Ask Relay tab for AI</span>
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
