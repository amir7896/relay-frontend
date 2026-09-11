import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useChatSocket } from '../../chat/ChatSocketContext';
import { Modal } from '../../components/Modal';
import { PeoplePicker } from '../../components/PeoplePicker';
import {
  conversationTitle,
  displayName,
  inboxTime,
  initials,
  otherMember,
} from '../../lib/format';
import { notify, subscribeWebPush, shouldShowNotificationBanner, dismissNotificationPrompt } from '../../lib/notifications';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { useDirectory } from '../../people/useDirectory';
import type { ChatMessage, Conversation, GlobalSearchHit, Paginated, UserProfile } from '../../api/types';

export type MessengerOutletContext = {
  openNewChat: () => void;
  openNewGroup: () => void;
  clearUnread: (conversationId: string) => void;
  refreshInbox: () => Promise<void>;
  conversations: Conversation[];
};

function hitConversationTitle(
  hit: GlobalSearchHit,
  me: string | undefined,
  byUserId: Map<string, UserProfile>,
) {
  if (hit.conversation.type === 'group') {
    return hit.conversation.name?.trim() || 'Group';
  }
  const peerId = hit.conversation.members.find((member) => member.userId !== me)?.userId;
  return displayName(peerId ? byUserId.get(peerId) : undefined);
}

function messageSnippet(message: ChatMessage, me?: string) {
  return previewText(message, me) ?? 'Message';
}

function previewText(message: ChatMessage | null | undefined, me?: string) {
  if (!message) {
    return null;
  }
  if (message.deletedForEveryone) {
    return 'This message was deleted';
  }
  if (message.type === 'call') {
    try {
      const parsed = JSON.parse(message.body) as {
        media?: string;
        kind?: string;
        outcome?: string;
        durationSeconds?: number;
      };
      const media = parsed.media === 'video' ? 'Video' : 'Voice';
      const group = parsed.kind === 'group' ? 'Group ' : '';
      if (parsed.outcome === 'missed') {
        return `Missed ${group.toLowerCase()}${media.toLowerCase()} call`;
      }
      if (parsed.outcome === 'declined') {
        return `${group}${media} call declined`;
      }
      if (parsed.outcome === 'cancelled') {
        return `${group}${media} call cancelled`;
      }
      if (parsed.durationSeconds && parsed.durationSeconds > 0) {
        const mins = Math.floor(parsed.durationSeconds / 60);
        const secs = parsed.durationSeconds % 60;
        return `${group}${media} call · ${mins}:${String(secs).padStart(2, '0')}`;
      }
      return `${group}${media} call`;
    } catch {
      return 'Call';
    }
  }
  if (message.attachment && message.type === 'image') {
    const prefix = message.senderId === me ? 'You: ' : '';
    return `${prefix}Photo`;
  }
  if (message.type === 'audio') {
    const prefix = message.senderId === me ? 'You: ' : '';
    return `${prefix}Voice note`;
  }
  if (message.type === 'file' || (message.attachment && message.type !== 'image')) {
    const prefix = message.senderId === me ? 'You: ' : '';
    const name = message.attachment?.name?.trim();
    return `${prefix}${name || 'File'}`;
  }
  if (!message.body) {
    return null;
  }
  const prefix = message.senderId === me ? 'You: ' : '';
  const body = message.body.length > 64 ? `${message.body.slice(0, 64)}…` : message.body;
  return `${prefix}${body}`;
}

function normalizeConversation(item: Conversation): Conversation {
  return {
    ...item,
    muted: Boolean(item.muted),
    pinned: Boolean(item.pinned),
    lastMessage: item.lastMessage
      ? {
          ...item.lastMessage,
          reactions: item.lastMessage.reactions ?? [],
          attachment: item.lastMessage.attachment ?? null,
          mentions: item.lastMessage.mentions ?? [],
          linkPreview: item.lastMessage.linkPreview ?? null,
          editedAt: item.lastMessage.editedAt ?? null,
          forwarded: Boolean(item.lastMessage.forwarded),
        }
      : null,
  };
}

export function MessengerPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const threadMatch = useMatch('/chat/:id');
  const activeConversationId = threadMatch?.params.id;
  const hasThread = Boolean(activeConversationId);
  const activeIdRef = useRef(activeConversationId);
  activeIdRef.current = activeConversationId;
  const me = session?.user.id;
  const meRef = useRef(me);
  meRef.current = me;
  const { people, byUserId, error: directoryError, ensureProfiles } = useDirectory();
  const [items, setItems] = useState<Conversation[]>([]);
  const [query, setQuery] = useState('');
  const [messageHits, setMessageHits] = useState<GlobalSearchHit[]>([]);
  const [messageSearchBusy, setMessageSearchBusy] = useState(false);
  const [error, setError] = useState('');
  const [modalError, setModalError] = useState('');
  const [dmOpen, setDmOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notifyBanner, setNotifyBanner] = useState(false);
  const { showBanner: showInstallBanner, install, dismissBanner: dismissInstall } =
    usePwaInstall();
  const [, setClock] = useState(0);
  const { subscribe, leaveConversation } = useChatSocket();
  const itemsRef = useRef<Conversation[]>([]);
  itemsRef.current = items;
  const byUserIdRef = useRef(byUserId);
  byUserIdRef.current = byUserId;

  const clearUnread = useCallback((conversationId: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === conversationId && item.unreadCount > 0
          ? { ...item, unreadCount: 0 }
          : item,
      ),
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await api<Paginated<Conversation>>(
        '/chat/conversations?page=1&limit=50',
      );
      const activeId = activeIdRef.current;
      setItems(
        response.data.items.map((item) => {
          const normalized = normalizeConversation(item);
          return item.id === activeId
            ? { ...normalized, unreadCount: 0 }
            : normalized;
        }),
      );
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load chats');
    }
  }, []);

  const applyInboxMessage = useCallback((message: ChatMessage) => {
    const selfId = meRef.current;
    const activeId = activeIdRef.current;
    const fromOther = Boolean(selfId && message.senderId !== selfId);
    const existing = itemsRef.current.find(
      (item) => item.id === message.conversationId,
    );
    const last = existing?.lastMessage;
    const messageTime = new Date(message.createdAt).getTime();
    const lastTime = last ? new Date(last.createdAt).getTime() : 0;
    const isLatestUpdate =
      !existing ||
      !last ||
      last.id === message.id ||
      messageTime >= lastTime;
    const isBrandNew = Boolean(existing && (!last || last.id !== message.id));
    const shouldNotify =
      Boolean(existing) &&
      fromOther &&
      isBrandNew &&
      isLatestUpdate &&
      !existing?.muted;

    setItems((current) => {
      const index = current.findIndex((item) => item.id === message.conversationId);
      if (index === -1) {
        void load();
        return current;
      }
      const row = current[index];
      const isActive = row.id === activeId;
      const rowLast = row.lastMessage;
      const rowMessageTime = new Date(message.createdAt).getTime();
      const rowLastTime = rowLast ? new Date(rowLast.createdAt).getTime() : 0;
      const rowIsLatest =
        !rowLast || rowLast.id === message.id || rowMessageTime >= rowLastTime;
      if (!rowIsLatest) {
        return current;
      }

      const rowIsBrandNew = !rowLast || rowLast.id !== message.id;
      const unreadCount =
        isActive || !fromOther || !rowIsBrandNew
          ? isActive
            ? 0
            : row.unreadCount
          : row.unreadCount + 1;

      const updated: Conversation = {
        ...row,
        lastMessageAt: message.createdAt,
        lastMessage: message,
        unreadCount,
      };
      const without = current.filter((_, i) => i !== index);
      if (row.pinned) {
        const firstUnpinned = without.findIndex((item) => !item.pinned);
        if (firstUnpinned === -1) {
          return [...without, updated];
        }
        return [
          ...without.slice(0, firstUnpinned),
          updated,
          ...without.slice(firstUnpinned),
        ];
      }
      return [updated, ...without];
    });

    if (!shouldNotify) {
      return;
    }
    const inactiveOrHidden =
      document.hidden || message.conversationId !== activeId;
    if (!inactiveOrHidden) {
      return;
    }
    const title = existing
      ? conversationTitle(existing, selfId, byUserIdRef.current)
      : 'New message';
    const body =
      message.attachment && message.type === 'image'
        ? 'Sent a photo'
        : message.body || 'New message';
    notify({
      title,
      body: body.length > 120 ? `${body.slice(0, 120)}…` : body,
      tag: message.conversationId,
    });
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setNotifyBanner(shouldShowNotificationBanner());
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }
    clearUnread(activeConversationId);
  }, [activeConversationId, clearUnread]);

  useEffect(() => {
    const unsubs = [
      subscribe('chat:message', (payload) => {
        applyInboxMessage(payload as ChatMessage);
      }),
      subscribe('chat:message_deleted', (payload) => {
        const message = payload as ChatMessage;
        setItems((current) =>
          current.map((item) =>
            item.id === message.conversationId && item.lastMessage?.id === message.id
              ? { ...item, lastMessage: message }
              : item,
          ),
        );
      }),
      subscribe(
        'chat:presence',
        (payload) => {
          const event = payload as {
            userId: string;
            status: 'online' | 'offline';
            conversationId?: string;
          };
          setItems((current) =>
            current.map((item) => {
              if (event.conversationId && item.id !== event.conversationId) {
                return item;
              }
              if (!item.members.some((member) => member.userId === event.userId)) {
                return item;
              }
              return {
                ...item,
                members: item.members.map((member) =>
                  member.userId === event.userId
                    ? { ...member, status: event.status }
                    : member,
                ),
              };
            }),
          );
        },
      ),
      subscribe('chat:group_deleted', (payload) => {
        const event = payload as { conversationId: string };
        setItems((current) => current.filter((item) => item.id !== event.conversationId));
        if (activeIdRef.current === event.conversationId) {
          navigate('/chat');
        }
      }),
      subscribe('chat:conversation_updated', (payload) => {
        const conversation = payload as Conversation;
        if (!conversation?.id) {
          return;
        }
        setItems((current) => {
          const index = current.findIndex((item) => item.id === conversation.id);
          if (index === -1) {
            // Newly added to this group — show it immediately
            const incoming: Conversation = {
              ...conversation,
              unreadCount: 0,
              muted: false,
              pinned: false,
              lastReadAt: null,
            };
            return [incoming, ...current];
          }
          const existing = current[index];
          const updated: Conversation = {
            ...conversation,
            unreadCount: existing.unreadCount,
            muted: existing.muted,
            pinned: existing.pinned,
            lastReadAt: existing.lastReadAt,
            lastMessage: conversation.lastMessage ?? existing.lastMessage,
            lastMessageAt: conversation.lastMessageAt ?? existing.lastMessageAt,
          };
          const next = [...current];
          next[index] = updated;
          return next;
        });
      }),
      subscribe('chat:removed_from_group', (payload) => {
        const event = payload as { conversationId: string };
        if (!event?.conversationId) {
          return;
        }
        leaveConversation(event.conversationId);
        setItems((current) =>
          current.filter((item) => item.id !== event.conversationId),
        );
        if (activeIdRef.current === event.conversationId) {
          navigate('/chat');
        }
      }),
    ];
    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [applyInboxMessage, leaveConversation, navigate, subscribe]);

  useEffect(() => {
    const memberIds = items.flatMap((item) =>
      item.members.map((member) => member.userId),
    );
    void ensureProfiles(memberIds);
  }, [items, ensureProfiles]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return items;
    }
    return items.filter((item) =>
      conversationTitle(item, me, byUserId).toLowerCase().includes(term),
    );
  }, [items, query, me, byUserId]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setMessageHits([]);
      setMessageSearchBusy(false);
      return;
    }

    let cancelled = false;
    setMessageSearchBusy(true);
    const timer = window.setTimeout(() => {
      void api<Paginated<GlobalSearchHit>>(
        `/chat/search?q=${encodeURIComponent(term)}&page=1&limit=25`,
      )
        .then((response) => {
          if (cancelled) {
            return;
          }
          setMessageHits(response.data.items);
          const memberIds = response.data.items.flatMap((hit) =>
            hit.conversation.members.map((member) => member.userId),
          );
          void ensureProfiles(memberIds);
        })
        .catch(() => {
          if (!cancelled) {
            setMessageHits([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setMessageSearchBusy(false);
          }
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, ensureProfiles]);

  const outletContext: MessengerOutletContext = {
    openNewChat: () => {
      setModalError('');
      setDmOpen(true);
    },
    openNewGroup: () => {
      setModalError('');
      setGroupMembers([]);
      setGroupName('');
      setGroupOpen(true);
    },
    clearUnread,
    refreshInbox: load,
    conversations: items,
  };

  async function togglePin(event: MouseEvent, item: Conversation) {
    event.preventDefault();
    event.stopPropagation();
    try {
      const response = await api<Conversation>(`/chat/conversations/${item.id}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned: !item.pinned }),
      });
      setItems((current) => {
        const updated = current.map((row) =>
          row.id === item.id
            ? { ...row, pinned: Boolean(response.data.pinned) }
            : row,
        );
        return [...updated].sort((a, b) => {
          if (a.pinned !== b.pinned) {
            return Number(b.pinned) - Number(a.pinned);
          }
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bTime - aTime;
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update pin');
    }
  }

  async function enableNotifications() {
    try {
      const permission = await subscribeWebPush();
      setNotifyBanner(permission === 'default' && shouldShowNotificationBanner());
      if (permission === 'granted' || permission === 'disabled') {
        setNotifyBanner(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable push notifications');
    }
  }

  function dismissNotifications() {
    dismissNotificationPrompt();
    setNotifyBanner(false);
  }

  async function startPrivate(userId: string) {
    setBusy(true);
    setModalError('');
    try {
      const response = await api<Conversation>('/chat/private', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      setDmOpen(false);
      await load();
      navigate(`/chat/${response.data.id}`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not start chat');
    } finally {
      setBusy(false);
    }
  }

  function toggleGroupMember(userId: string) {
    setGroupMembers((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  async function startGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (groupMembers.length === 0) {
      setModalError('Add at least one person to the group');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      const response = await api<Conversation>('/chat/groups', {
        method: 'POST',
        body: JSON.stringify({ name: groupName.trim(), memberIds: groupMembers }),
      });
      setGroupOpen(false);
      setGroupName('');
      setGroupMembers([]);
      await load();
      navigate(`/chat/${response.data.id}`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not create group');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={hasThread ? 'messenger has-thread' : 'messenger'}>
      <aside className="inbox">
        <div className="inbox-head">
          <div className="inbox-head-top">
            <h1>Chats</h1>
            <div className="inbox-head-actions">
              <button
                className="ghost icon-btn"
                type="button"
                aria-label="New chat"
                title="New chat"
                onClick={outletContext.openNewChat}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 12H6v-2h12zm0-3H6V9h12zm0-3H6V6h12z"
                  />
                </svg>
              </button>
              <button
                className="ghost icon-btn"
                type="button"
                aria-label="New group"
                title="New group"
                onClick={outletContext.openNewGroup}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-.9.1 1 0.7 1.9 1.6 1.9 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div className="inbox-search-wrap">
            <input
              className="inbox-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats and messages"
              aria-label="Search chats and messages"
            />
          </div>
        </div>
        {error ? <p className="error pad">{error}</p> : null}
        {directoryError ? <p className="error pad">{directoryError}</p> : null}
        {notifyBanner ? (
          <div className="notify-banner">
            <p>Enable desktop notifications for new messages while you are away.</p>
            <button className="btn" type="button" onClick={() => void enableNotifications()}>
              Allow notifications
            </button>
            <button className="ghost" type="button" onClick={dismissNotifications}>
              Not now
            </button>
          </div>
        ) : null}
        {showInstallBanner ? (
          <div className="notify-banner install-banner">
            <p>Install Relay on this device for a full-screen app experience.</p>
            <button
              className="btn"
              type="button"
              onClick={() => {
                void install();
              }}
            >
              Install
            </button>
            <button className="ghost" type="button" onClick={dismissInstall}>
              Not now
            </button>
          </div>
        ) : null}
        <div className="inbox-list">
          {query.trim() ? (
            <p className="inbox-section-label">Chats</p>
          ) : null}
          {filtered.map((item) => {
            const title = conversationTitle(item, me, byUserId);
            const peer = otherMember(item, me);
            const peerProfile = peer ? byUserId.get(peer.userId) : undefined;
            const avatarLabel =
              item.type === 'group' ? title : displayName(peerProfile);
            const online =
              item.type === 'group'
                ? item.members.some(
                    (member) => member.status === 'online' && member.userId !== me,
                  )
                : peer?.status === 'online';
            const preview =
              previewText(item.lastMessage, me) ??
              (item.type === 'group' ? 'Group' : 'Direct');
            const timeLabel = inboxTime(item.lastMessageAt);
            const unread =
              item.id !== activeConversationId && item.unreadCount > 0
                ? item.unreadCount
                : 0;
            return (
              <NavLink
                key={item.id}
                className={`chat-row${item.muted ? ' muted-chat' : ''}${
                  item.pinned ? ' pinned-chat' : ''
                }${unread ? ' has-unread' : ''}`}
                to={`/chat/${item.id}`}
              >
                <span className="chat-avatar-wrap">
                  <span className="avatar sm">{initials(avatarLabel)}</span>
                  <span className={online ? 'presence on' : 'presence'} />
                </span>
                <span className="chat-row-main">
                  <span className="chat-row-top">
                    <strong className="chat-row-title">
                      {item.pinned ? (
                        <span className="pin-badge" title="Pinned" aria-hidden="true">
                          📌
                        </span>
                      ) : null}
                      {title}
                    </strong>
                    {timeLabel ? (
                      <time
                        className={`chat-row-time${unread ? ' unread-time' : ''}`}
                        dateTime={item.lastMessageAt ?? undefined}
                      >
                        {timeLabel}
                      </time>
                    ) : null}
                  </span>
                  <span className="chat-row-bottom">
                    <small className="chat-row-preview">
                      {item.muted ? (
                        <span className="chat-mute-icon" title="Muted" aria-label="Muted">
                          🔇
                        </span>
                      ) : null}
                      {preview}
                    </small>
                    <span className="chat-row-trailing">
                      <button
                        className="ghost pin-toggle"
                        type="button"
                        title={item.pinned ? 'Unpin chat' : 'Pin chat'}
                        aria-label={item.pinned ? 'Unpin chat' : 'Pin chat'}
                        onClick={(event) => void togglePin(event, item)}
                      >
                        {item.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      {unread > 0 ? (
                        <span className={`unread${item.muted ? ' quiet' : ''}`}>
                          {unread > 99 ? '99+' : unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </span>
              </NavLink>
            );
          })}
          {query.trim().length >= 2 ? (
            <>
              <p className="inbox-section-label">
                Messages
                {messageSearchBusy ? '…' : messageHits.length ? ` · ${messageHits.length}` : ''}
              </p>
              {messageHits.map((hit) => {
                const title = hitConversationTitle(hit, me, byUserId);
                const snippet = messageSnippet(hit.message, me);
                const timeLabel = inboxTime(hit.message.createdAt);
                return (
                  <button
                    key={hit.message.id}
                    type="button"
                    className="chat-row global-search-hit"
                    onClick={() => {
                      navigate(`/chat/${hit.conversation.id}?focus=${hit.message.id}`);
                    }}
                  >
                    <span className="chat-avatar-wrap">
                      <span className="avatar sm">{initials(title)}</span>
                    </span>
                    <span className="chat-row-main">
                      <span className="chat-row-top">
                        <strong className="chat-row-title">{title}</strong>
                        {timeLabel ? (
                          <time
                            className="chat-row-time"
                            dateTime={hit.message.createdAt}
                          >
                            {timeLabel}
                          </time>
                        ) : null}
                      </span>
                      <span className="chat-row-bottom">
                        <small className="chat-row-preview">{snippet}</small>
                      </span>
                    </span>
                  </button>
                );
              })}
              {!messageSearchBusy && messageHits.length === 0 ? (
                <p className="muted pad inbox-search-empty">No messages match that search.</p>
              ) : null}
            </>
          ) : null}
          {filtered.length === 0 && !(query.trim().length >= 2 && (messageHits.length > 0 || messageSearchBusy)) ? (
            <div className="inbox-empty">
              <p className="muted">
                {query.trim()
                  ? 'No chats match that search.'
                  : 'No conversations yet. Start with a direct message or a group.'}
              </p>
              {!query.trim() ? (
                <button className="btn" type="button" onClick={outletContext.openNewChat}>
                  Start a chat
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
      <Outlet context={outletContext} />

      <Modal
        open={dmOpen}
        title="New chat"
        size="lg"
        onClose={() => {
          setDmOpen(false);
          setModalError('');
        }}
      >
        <p className="muted modal-lead">
          Pick someone from the workspace to start a private thread.
        </p>
        {modalError ? <p className="error">{modalError}</p> : null}
        <PeoplePicker
          people={people}
          mode="single"
          onPick={(person) => {
            if (!busy) {
              void startPrivate(person.userId);
            }
          }}
        />
      </Modal>

      <Modal
        open={groupOpen}
        title="New group"
        size="lg"
        onClose={() => {
          setGroupOpen(false);
          setGroupMembers([]);
          setModalError('');
        }}
      >
        <form className="modal-form" onSubmit={(event) => void startGroup(event)}>
          <label>
            Group name
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              required
              maxLength={120}
              placeholder="Launch team"
            />
          </label>
          <div className="modal-section">
            <p className="muted">
              {groupMembers.length === 0
                ? 'Select people to add'
                : `${groupMembers.length} selected`}
            </p>
            <PeoplePicker
              people={people}
              mode="multi"
              selected={groupMembers}
              onToggle={toggleGroupMember}
            />
          </div>
          {modalError ? <p className="error">{modalError}</p> : null}
          <button
            className="btn full"
            type="submit"
            disabled={busy || groupMembers.length === 0 || !groupName.trim()}
          >
            Create group
          </button>
        </form>
      </Modal>
    </div>
  );
}
