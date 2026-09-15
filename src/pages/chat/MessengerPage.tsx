import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useChatSocket } from '../../chat/ChatSocketContext';
import { Modal } from '../../components/Modal';
import { useConfirm, usePrompt } from '../../components/ConfirmProvider';
import { PeoplePicker } from '../../components/PeoplePicker';
import {
  conversationTitle,
  displayName,
  formatScheduleWhen,
  otherMember,
} from '../../lib/format';
import { RelativeTime } from '../../components/RelativeTime';
import { notify, subscribeWebPush, shouldShowNotificationBanner, dismissNotificationPrompt, loadNotificationPrefs, shouldNotifyForMessage } from '../../lib/notifications';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { useDirectory } from '../../people/useDirectory';
import { UserAvatar } from '../../components/UserAvatar';
import { useOrganization } from '../../organizations/OrganizationContext';
import type {
  ChatMessage,
  Conversation,
  GlobalSearchHit,
  MessageReminder,
  Paginated,
  PresenceStatus,
  SidebarSection,
  ThreadSummary,
  UserProfile,
} from '../../api/types';

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
  if (message.type === 'poll' || message.poll) {
    const prefix = message.senderId === me ? 'You: ' : '';
    const question = message.poll?.question || message.body || 'Poll';
    return `${prefix}📊 ${question.length > 48 ? `${question.slice(0, 48)}…` : question}`;
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
    blockedByMe: Boolean(item.blockedByMe),
    blockedMe: Boolean(item.blockedMe),
    hasUnreadMention: Boolean(item.hasUnreadMention),
    firstUnreadMentionMessageId: item.firstUnreadMentionMessageId ?? null,
    lastMessage: item.lastMessage
      ? {
          ...item.lastMessage,
          reactions: item.lastMessage.reactions ?? [],
          attachment: item.lastMessage.attachment ?? null,
          mentions: item.lastMessage.mentions ?? [],
          linkPreview: item.lastMessage.linkPreview ?? null,
          poll: item.lastMessage.poll ?? null,
          editedAt: item.lastMessage.editedAt ?? null,
          forwarded: Boolean(item.lastMessage.forwarded),
          undelivered: Boolean(item.lastMessage.undelivered),
        }
      : null,
  };
}

export function MessengerPage() {
  const { session } = useAuth();
  const confirmDialog = useConfirm();
  const promptDialog = usePrompt();
  const { organizations, activeOrganizationId } = useOrganization();
  const navigate = useNavigate();
  const threadMatch = useMatch({ path: '/chat/:id', end: false });
  const detailsMatch = useMatch({ path: '/chat/:id/details', end: true });
  const activeConversationId = threadMatch?.params.id;
  const hasThread = Boolean(activeConversationId);
  const hasDetails = Boolean(detailsMatch);
  const activeIdRef = useRef(activeConversationId);
  activeIdRef.current = activeConversationId;
  const me = session?.user.id;
  const meRef = useRef(me);
  meRef.current = me;
  const activeOrg =
    organizations.find((org) => org.id === activeOrganizationId) ??
    organizations[0];
  const isGuest = activeOrg?.role === 'guest';
  const openedGeneralRef = useRef(false);
  const { people, byUserId, error: directoryError, ensureProfiles, refreshDirectory } =
    useDirectory();
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
  const [groupVisibility, setGroupVisibility] = useState<'public' | 'private'>(
    'private',
  );
  const [groupAnnounceOnly, setGroupAnnounceOnly] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [publicChannels, setPublicChannels] = useState<Conversation[]>([]);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [threadItems, setThreadItems] = useState<ThreadSummary[]>([]);
  const [threadsBusy, setThreadsBusy] = useState(false);
  const [threadsUnreadTotal, setThreadsUnreadTotal] = useState(0);
  const [laterOpen, setLaterOpen] = useState(false);
  const [laterItems, setLaterItems] = useState<MessageReminder[]>([]);
  const [laterBusy, setLaterBusy] = useState(false);
  const [sidebarSections, setSidebarSections] = useState<SidebarSection[]>([]);
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notifyBanner, setNotifyBanner] = useState(false);
  const { showBanner: showInstallBanner, install, dismissBanner: dismissInstall } =
    usePwaInstall();
  const { subscribe, leaveConversation } = useChatSocket();
  const itemsRef = useRef<Conversation[]>([]);
  itemsRef.current = items;
  const myStatusRef = useRef<PresenceStatus>('online');
  const byUserIdRef = useRef(byUserId);
  byUserIdRef.current = byUserId;

  const clearUnread = useCallback((conversationId: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === conversationId &&
        (item.unreadCount > 0 || item.hasUnreadMention)
          ? {
              ...item,
              unreadCount: 0,
              hasUnreadMention: false,
              firstUnreadMentionMessageId: null,
            }
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
            ? {
                ...normalized,
                unreadCount: 0,
                hasUnreadMention: false,
                firstUnreadMentionMessageId: null,
              }
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
    const mentionsMe =
      Boolean(selfId) && (message.mentions ?? []).includes(selfId!);
    // Slack-style: muted chats stay quiet unless you were @mentioned.
    const shouldNotify =
      Boolean(existing) &&
      fromOther &&
      isBrandNew &&
      isLatestUpdate &&
      (!existing?.muted || mentionsMe) &&
      shouldNotifyForMessage({
        mentionsMe,
        myStatus: myStatusRef.current,
      });

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
      const hasUnreadMention = isActive
        ? false
        : fromOther && mentionsMe && rowIsBrandNew
          ? true
          : row.hasUnreadMention;
      const firstUnreadMentionMessageId = isActive
        ? null
        : fromOther && mentionsMe && rowIsBrandNew
          ? row.firstUnreadMentionMessageId ?? message.id
          : row.firstUnreadMentionMessageId ?? null;

      const updated: Conversation = {
        ...row,
        lastMessageAt: message.createdAt,
        lastMessage: message,
        unreadCount,
        hasUnreadMention,
        firstUnreadMentionMessageId,
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
    const chatTitle = existing
      ? conversationTitle(existing, selfId, byUserIdRef.current)
      : 'New message';
    const title = mentionsMe ? `${chatTitle} · mentioned you` : chatTitle;
    const preview =
      message.attachment && message.type === 'image'
        ? 'Sent a photo'
        : message.body || 'New message';
    const body = mentionsMe
      ? preview.startsWith('@')
        ? preview
        : `Mention: ${preview}`
      : preview;
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
    let cancelled = false;
    async function refreshThreadBadge() {
      try {
        const response = await api<Paginated<ThreadSummary>>(
          '/chat/threads?page=1&limit=40',
        );
        if (cancelled) return;
        const unread = (response.data.items ?? []).reduce(
          (sum, item) => sum + (item.unreadCount ?? 0),
          0,
        );
        setThreadsUnreadTotal(unread);
      } catch {
        // ignore badge errors
      }
    }
    async function refreshLaterBadge() {
      try {
        const response = await api<MessageReminder[]>('/chat/reminders');
        if (cancelled) return;
        setLaterItems(response.data ?? []);
      } catch {
        // ignore
      }
    }
    void refreshThreadBadge();
    void refreshLaterBadge();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setNotifyBanner(shouldShowNotificationBanner());
    void loadNotificationPrefs();
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
            status: 'online' | 'away' | 'busy' | 'dnd' | 'offline';
            conversationId?: string;
            customStatus?: string | null;
            lastSeenAt?: string | null;
          };
          if (event.userId === meRef.current) {
            myStatusRef.current = event.status;
          }
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
                    ? {
                        ...member,
                        status: event.status,
                        customStatus:
                          event.customStatus !== undefined
                            ? event.customStatus
                            : member.customStatus,
                        lastSeenAt:
                          event.status === 'offline'
                            ? (event.lastSeenAt ?? member.lastSeenAt)
                            : null,
                      }
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
              hasUnreadMention: false,
              firstUnreadMentionMessageId: null,
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
            hasUnreadMention: existing.hasUnreadMention,
            firstUnreadMentionMessageId: existing.firstUnreadMentionMessageId,
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
    void refreshDirectory();
  }, [refreshDirectory]);

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

  const sectionedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of sidebarSections) {
      for (const id of section.conversationIds ?? []) {
        ids.add(id);
      }
    }
    return ids;
  }, [sidebarSections]);

  const channels = useMemo(
    () =>
      filtered.filter(
        (item) => item.type === 'group' && !sectionedIds.has(item.id),
      ),
    [filtered, sectionedIds],
  );
  const directs = useMemo(
    () =>
      filtered.filter(
        (item) => item.type === 'private' && !sectionedIds.has(item.id),
      ),
    [filtered, sectionedIds],
  );

  const conversationsById = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const item of filtered) {
      map.set(item.id, item);
    }
    return map;
  }, [filtered]);

  const loadSidebarSections = useCallback(async () => {
    try {
      const response = await api<SidebarSection[]>('/chat/sidebar/sections');
      setSidebarSections(response.data);
    } catch {
      setSidebarSections([]);
    }
  }, []);

  useEffect(() => {
    void loadSidebarSections();
  }, [loadSidebarSections, activeOrganizationId]);

  const peopleHits = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) {
      return [];
    }
    return people
      .filter((person) => {
        if (person.userId === me) {
          return false;
        }
        const name = `${person.firstName} ${person.lastName}`.trim().toLowerCase();
        return (
          name.includes(term) ||
          person.email.toLowerCase().includes(term)
        );
      })
      .slice(0, 12);
  }, [people, query, me]);

  useEffect(() => {
    openedGeneralRef.current = false;
  }, [activeOrganizationId]);

  useEffect(() => {
    if (hasThread || openedGeneralRef.current || items.length === 0) {
      return;
    }
    const general = items.find(
      (item) =>
        item.type === 'group' &&
        (item.name?.trim().toLowerCase() === 'general' ||
          item.name?.trim().toLowerCase() === '#general'),
    );
    if (general) {
      openedGeneralRef.current = true;
      navigate(`/chat/${general.id}`, { replace: true });
    }
  }, [hasThread, items, navigate]);

  useEffect(() => {
    const term = query.trim();
    const looksLikeOperator = /\b(from|in|has|before|after):/i.test(term);
    if (!looksLikeOperator && term.length < 2) {
      setMessageHits([]);
      setMessageSearchBusy(false);
      return;
    }
    if (!term) {
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
      setGroupVisibility('private');
      setGroupAnnounceOnly(false);
      setGroupOpen(true);
    },
    clearUnread,
    refreshInbox: load,
    conversations: items,
  };

  function sectionIdForConversation(conversationId: string): string | null {
    for (const section of sidebarSections) {
      if ((section.conversationIds ?? []).includes(conversationId)) {
        return section.id;
      }
    }
    return null;
  }

  async function createSidebarSection() {
    const name = await promptDialog({
      title: 'New sidebar section',
      message: 'Name for this sidebar section',
      placeholder: 'e.g. Design',
      confirmLabel: 'Create',
      maxLength: 80,
    });
    if (!name?.trim()) {
      return;
    }
    setSidebarBusy(true);
    setError('');
    try {
      const response = await api<SidebarSection>('/chat/sidebar/sections', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setSidebarSections((current) =>
        [...current, response.data].sort((a, b) => a.sortOrder - b.sortOrder),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create section');
    } finally {
      setSidebarBusy(false);
    }
  }

  async function toggleSectionCollapsed(section: SidebarSection) {
    try {
      const response = await api<SidebarSection>(
        `/chat/sidebar/sections/${section.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ collapsed: !section.collapsed }),
        },
      );
      setSidebarSections((current) =>
        current.map((row) => (row.id === section.id ? response.data : row)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update section');
    }
  }

  async function renameSidebarSection(section: SidebarSection) {
    const name = await promptDialog({
      title: 'Rename section',
      message: 'Choose a new name for this sidebar section',
      defaultValue: section.name,
      confirmLabel: 'Rename',
      maxLength: 80,
    });
    if (!name?.trim() || name.trim() === section.name) {
      return;
    }
    try {
      const response = await api<SidebarSection>(
        `/chat/sidebar/sections/${section.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: name.trim() }),
        },
      );
      setSidebarSections((current) =>
        current.map((row) => (row.id === section.id ? response.data : row)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename section');
    }
  }

  async function deleteSidebarSection(section: SidebarSection) {
    const ok = await confirmDialog({
      title: 'Delete section',
      message: `Delete section “${section.name}”? Conversations return to Channels / DMs.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) {
      return;
    }
    try {
      await api(`/chat/sidebar/sections/${section.id}`, { method: 'DELETE' });
      setSidebarSections((current) =>
        current.filter((row) => row.id !== section.id),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete section');
    }
  }

  async function moveConversationToSection(
    conversationId: string,
    targetSectionId: string,
  ) {
    const currentSectionId = sectionIdForConversation(conversationId);
    if (currentSectionId === targetSectionId || (!currentSectionId && !targetSectionId)) {
      return;
    }
    setSidebarBusy(true);
    setError('');
    try {
      let nextSections = sidebarSections;
      if (currentSectionId) {
        const current = sidebarSections.find((row) => row.id === currentSectionId);
        if (current) {
          const response = await api<SidebarSection>(
            `/chat/sidebar/sections/${current.id}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                conversationIds: (current.conversationIds ?? []).filter(
                  (id) => id !== conversationId,
                ),
              }),
            },
          );
          nextSections = nextSections.map((row) =>
            row.id === current.id ? response.data : row,
          );
        }
      }
      if (targetSectionId) {
        const target =
          nextSections.find((row) => row.id === targetSectionId) ??
          sidebarSections.find((row) => row.id === targetSectionId);
        if (target) {
          const response = await api<SidebarSection>(
            `/chat/sidebar/sections/${target.id}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                conversationIds: [
                  ...new Set([...(target.conversationIds ?? []), conversationId]),
                ],
              }),
            },
          );
          nextSections = nextSections.map((row) =>
            row.id === target.id ? response.data : row,
          );
        }
      }
      setSidebarSections(nextSections);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move conversation');
      await loadSidebarSections();
    } finally {
      setSidebarBusy(false);
    }
  }

  function renderConversationRow(item: Conversation) {
    const title = conversationTitle(item, me, byUserId);
    const peer = otherMember(item, me);
    const peerProfile = peer ? byUserId.get(peer.userId) : undefined;
    const avatarLabel =
      item.type === 'group' ? title : displayName(peerProfile);
    const online =
      item.type === 'group'
        ? item.members.some(
            (member) => member.status !== 'offline' && member.userId !== me,
          )
        : Boolean(peer && peer.status !== 'offline');
    const presenceClass =
      peer && peer.status !== 'offline'
        ? `presence on presence-${peer.status}`
        : 'presence';
    const preview =
      previewText(item.lastMessage, me) ??
      (item.type === 'group' ? 'Channel' : 'Direct message');
    const unread =
      item.id !== activeConversationId && item.unreadCount > 0
        ? item.unreadCount
        : 0;
    const mentionUnread =
      item.id !== activeConversationId && Boolean(item.hasUnreadMention);
    const isChannel = item.type === 'group';

    return (
      <NavLink
        key={item.id}
        className={`chat-row${isChannel ? ' channel-row' : ''}${
          item.muted ? ' muted-chat' : ''
        }${item.pinned ? ' pinned-chat' : ''}${
          unread || mentionUnread ? ' has-unread' : ''
        }${mentionUnread ? ' has-mention' : ''}`}
        to={`/chat/${item.id}`}
      >
        <span className="chat-avatar-wrap">
          {isChannel ? (
            <span className="channel-hash" aria-hidden="true">
              #
            </span>
          ) : (
            <UserAvatar profile={peerProfile} name={avatarLabel} size="sm" />
          )}
          {!isChannel ? (
            <span className={online ? presenceClass : 'presence'} />
          ) : null}
        </span>
        <span className="chat-row-main">
          <span className="chat-row-copy">
            <strong className="chat-row-title">
              {item.pinned ? (
                <span className="pin-badge" title="Pinned" aria-hidden="true">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2zm-1.5 2h-5L11 12.5V4h2v8.5l1.5 1.5z"
                    />
                  </svg>
                </span>
              ) : null}
              {isChannel ? title.replace(/^#/, '') : title}
            </strong>
            <small className="chat-row-preview">
              {item.muted ? (
                <span className="chat-mute-icon" title="Muted" aria-label="Muted">
                  🔇
                </span>
              ) : null}
              {preview}
            </small>
          </span>
          <span className="chat-row-meta">
            {item.lastMessageAt ? (
              <RelativeTime
                className={`chat-row-time${unread ? ' unread-time' : ''}`}
                value={item.lastMessageAt}
              />
            ) : (
              <span className="chat-row-time chat-row-time-spacer" aria-hidden="true">
                &nbsp;
              </span>
            )}
            <span className="chat-row-trailing">
              {sidebarSections.length > 0 ? (
                <select
                  className="sidebar-section-move"
                  aria-label="Move to sidebar section"
                  title="Move to section"
                  disabled={sidebarBusy}
                  value={sectionIdForConversation(item.id) ?? ''}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  onChange={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void moveConversationToSection(item.id, event.target.value);
                  }}
                >
                  <option value="">
                    {item.type === 'group' ? 'Channels' : 'Direct messages'}
                  </option>
                  {sidebarSections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                className={`pin-toggle${item.pinned ? ' is-pinned' : ''}`}
                type="button"
                title={item.pinned ? 'Unpin' : 'Pin'}
                aria-label={item.pinned ? 'Unpin' : 'Pin'}
                onClick={(event) => void togglePin(event, item)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2zm-1.5 2h-5L11 12.5V4h2v8.5l1.5 1.5z"
                  />
                </svg>
              </button>
              {mentionUnread ? (
                <span
                  className={`mention-badge${item.muted ? ' quiet' : ''}`}
                  title="You were mentioned"
                  aria-label="Unread mention"
                >
                  @
                </span>
              ) : null}
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
  }

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
    if (!groupName.trim()) {
      setModalError('Channel name is required');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      const response = await api<Conversation>('/chat/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: groupName.trim().replace(/^#/, ''),
          memberIds: groupMembers,
          visibility: groupVisibility,
          announceOnly: groupAnnounceOnly,
        }),
      });
      setGroupOpen(false);
      setGroupName('');
      setGroupMembers([]);
      setGroupVisibility('private');
      setGroupAnnounceOnly(false);
      await load();
      navigate(`/chat/${response.data.id}`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not create channel');
    } finally {
      setBusy(false);
    }
  }

  async function openBrowsePublic() {
    setBrowseOpen(true);
    setModalError('');
    setBrowseBusy(true);
    try {
      const response = await api<Conversation[]>('/chat/channels/public');
      const joined = new Set(items.map((item) => item.id));
      setPublicChannels(
        (response.data ?? [])
          .map(normalizeConversation)
          .filter((item) => !joined.has(item.id)),
      );
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not load public channels',
      );
      setPublicChannels([]);
    } finally {
      setBrowseBusy(false);
    }
  }

  async function openThreadsHome() {
    setThreadsOpen(true);
    setModalError('');
    setThreadsBusy(true);
    try {
      const response = await api<Paginated<ThreadSummary>>(
        '/chat/threads?page=1&limit=40',
      );
      setThreadItems(response.data.items ?? []);
      const unread = (response.data.items ?? []).reduce(
        (sum, item) => sum + (item.unreadCount ?? 0),
        0,
      );
      setThreadsUnreadTotal(unread);
      const profileIds = (response.data.items ?? []).flatMap((item) => [
        item.root.senderId,
        ...(item.latestReply ? [item.latestReply.senderId] : []),
      ]);
      await ensureProfiles(profileIds);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not load threads',
      );
      setThreadItems([]);
    } finally {
      setThreadsBusy(false);
    }
  }

  async function openLaterInbox() {
    setLaterOpen(true);
    setModalError('');
    setLaterBusy(true);
    try {
      const response = await api<MessageReminder[]>('/chat/reminders');
      setLaterItems(response.data ?? []);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not load reminders',
      );
      setLaterItems([]);
    } finally {
      setLaterBusy(false);
    }
  }

  async function cancelLaterReminder(reminderId: string) {
    try {
      await api(`/chat/reminders/${reminderId}`, { method: 'DELETE' });
      setLaterItems((current) =>
        current.filter((item) => item.id !== reminderId),
      );
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not cancel reminder',
      );
    }
  }

  async function joinPublicChannel(conversationId: string) {
    setBusy(true);
    setModalError('');
    try {
      const response = await api<Conversation>(
        `/chat/conversations/${conversationId}/join`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setBrowseOpen(false);
      await load();
      navigate(`/chat/${response.data.id}`);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not join channel');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={[
        'messenger',
        'slack-messenger',
        hasThread ? 'has-thread' : '',
        hasDetails ? 'has-details' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <aside className="inbox">
        <div className="inbox-head">
          <div className="inbox-head-top">
            <div className="inbox-workspace">
              <h1>{activeOrg?.name ?? 'Workspace'}</h1>
              <p className="muted inbox-workspace-sub">
                {isGuest
                  ? 'Guest — channels you are invited to'
                  : 'Channels & messages'}
              </p>
            </div>
            <div className="inbox-head-actions">
              {!isGuest ? (
                <>
              <button
                className="inbox-action-btn"
                type="button"
                aria-label="New direct message"
                title="New direct message"
                onClick={outletContext.openNewChat}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 12H6v-2h12zm0-3H6V9h12zm0-3H6V6h12z"
                  />
                </svg>
              </button>
              <button
                className="inbox-action-btn"
                type="button"
                aria-label="Create a channel"
                title="Create a channel"
                onClick={outletContext.openNewGroup}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"
                  />
                </svg>
              </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="inbox-search-wrap">
            <input
              className="inbox-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search — try from:jane has:file in:general"
              aria-label="Search channels and messages"
              title="Operators: from:name · in:#channel · has:file|image|link|audio · after:7d · before:2024-01-01"
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
          <div className="inbox-section-head">
            <p className="inbox-section-label">
              Threads
              {threadsUnreadTotal > 0 ? (
                <span className="inbox-unread-pill">{threadsUnreadTotal}</span>
              ) : null}
            </p>
            <button
              type="button"
              className="inbox-section-add"
              aria-label="Open threads"
              title="Threads you follow"
              onClick={() => void openThreadsHome()}
            >
              ↗
            </button>
          </div>
          <button
            type="button"
            className="inbox-empty-link"
            onClick={() => void openThreadsHome()}
          >
            {threadsUnreadTotal > 0
              ? `${threadsUnreadTotal} unread in threads`
              : 'View threads you follow'}
          </button>

          <div className="inbox-section-head">
            <p className="inbox-section-label">
              Later
              {laterItems.length > 0 ? (
                <span className="inbox-unread-pill">{laterItems.length}</span>
              ) : null}
            </p>
            <button
              type="button"
              className="inbox-section-add"
              aria-label="Open Later reminders"
              title="Reminders"
              onClick={() => void openLaterInbox()}
            >
              ⏰
            </button>
          </div>
          <button
            type="button"
            className="inbox-empty-link"
            onClick={() => void openLaterInbox()}
          >
            {laterItems.length > 0
              ? `${laterItems.length} reminder${laterItems.length === 1 ? '' : 's'}`
              : 'Reminders from message menus'}
          </button>

          <div className="inbox-section-head">
            <p className="inbox-section-label">Channels</p>
            <div className="inbox-section-actions">
              {!isGuest ? (
                <>
              <button
                type="button"
                className="inbox-section-add"
                aria-label="Create sidebar section"
                title="Create a custom section"
                disabled={sidebarBusy}
                onClick={() => void createSidebarSection()}
              >
                ≡
              </button>
              <button
                type="button"
                className="inbox-section-add"
                aria-label="Browse public channels"
                title="Browse public channels"
                onClick={() => void openBrowsePublic()}
              >
                ⌕
              </button>
              <button
                type="button"
                className="inbox-section-add"
                aria-label="Create a channel"
                title="Create a channel"
                onClick={outletContext.openNewGroup}
              >
                +
              </button>
                </>
              ) : null}
            </div>
          </div>
          {sidebarSections.map((section) => {
            const sectionItems = (section.conversationIds ?? [])
              .map((id) => conversationsById.get(id))
              .filter((row): row is Conversation => Boolean(row));
            return (
              <div key={section.id} className="inbox-custom-section">
                <div className="inbox-section-head">
                  <button
                    type="button"
                    className="inbox-section-label inbox-section-toggle"
                    aria-expanded={!section.collapsed}
                    onClick={() => void toggleSectionCollapsed(section)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void renameSidebarSection(section);
                    }}
                    title="Click to collapse · right-click to rename"
                  >
                    <span aria-hidden="true">{section.collapsed ? '▸' : '▾'}</span>
                    {section.name}
                    {sectionItems.length > 0 ? (
                      <span className="inbox-unread-pill muted-pill">
                        {sectionItems.length}
                      </span>
                    ) : null}
                  </button>
                  <div className="inbox-section-actions">
                    <button
                      type="button"
                      className="inbox-section-add"
                      aria-label={`Delete ${section.name}`}
                      title="Delete section"
                      onClick={() => void deleteSidebarSection(section)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {!section.collapsed
                  ? sectionItems.map((item) => renderConversationRow(item))
                  : null}
                {!section.collapsed && sectionItems.length === 0 ? (
                  <p className="muted pad inbox-section-hint">
                    Use the section menu on a chat to move it here.
                  </p>
                ) : null}
              </div>
            );
          })}
          {channels.map((item) => renderConversationRow(item))}
          {channels.length === 0 && !query.trim() && sidebarSections.length === 0 ? (
            isGuest ? (
              <p className="muted inbox-empty-link">
                Ask a teammate to invite you to a channel
              </p>
            ) : (
            <button
              type="button"
              className="inbox-empty-link"
              onClick={outletContext.openNewGroup}
            >
              Create a channel
            </button>
            )
          ) : null}

          <div className="inbox-section-head">
            <p className="inbox-section-label">Direct messages</p>
            {!isGuest ? (
            <button
              type="button"
              className="inbox-section-add"
              aria-label="New direct message"
              title="New direct message"
              onClick={outletContext.openNewChat}
            >
              +
            </button>
            ) : null}
          </div>
          {directs.map((item) => renderConversationRow(item))}
          {directs.length === 0 && !query.trim() ? (
            isGuest ? (
              <p className="muted inbox-empty-link">No direct messages yet</p>
            ) : (
            <button
              type="button"
              className="inbox-empty-link"
              onClick={outletContext.openNewChat}
            >
              Message a teammate
            </button>
            )
          ) : null}

          {query.trim().length >= 2 ||
          /\b(from|in|has|before|after):/i.test(query) ? (
            <>
              <p className="inbox-section-label">People</p>
              {peopleHits.map((person) => (
                  <button
                    key={person.userId}
                    type="button"
                    className="chat-row global-search-hit"
                    onClick={() => {
                      void startPrivate(person.userId);
                    }}
                  >
                    <span className="chat-avatar-wrap">
                      <UserAvatar profile={person} name={displayName(person)} size="sm" />
                    </span>
                    <span className="chat-row-main">
                      <strong className="chat-row-title">{displayName(person)}</strong>
                      <small className="chat-row-preview">{person.email}</small>
                    </span>
                  </button>
                ))}
              <p className="inbox-section-label">
                Messages
                {messageSearchBusy ? '…' : messageHits.length ? ` · ${messageHits.length}` : ''}
              </p>
              {messageHits.map((hit) => {
                const title = hitConversationTitle(hit, me, byUserId);
                const snippet = messageSnippet(hit.message, me);
                const hitPeer =
                  hit.conversation.type === 'private'
                    ? hit.conversation.members.find((member) => member.userId !== me)
                    : undefined;
                const hitProfile = hitPeer
                  ? byUserId.get(hitPeer.userId)
                  : byUserId.get(hit.message.senderId);
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
                      <UserAvatar
                        profile={hit.conversation.type === 'group' ? null : hitProfile}
                        name={title}
                        size="sm"
                      />
                    </span>
                    <span className="chat-row-main">
                      <span className="chat-row-top">
                        <strong className="chat-row-title">{title}</strong>
                        <RelativeTime
                          className="chat-row-time"
                          value={hit.message.createdAt}
                        />
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
          {filtered.length === 0 && query.trim() && !(query.trim().length >= 2 && (messageHits.length > 0 || messageSearchBusy)) ? (
            <div className="inbox-empty">
              <p className="muted">No channels or DMs match that search.</p>
            </div>
          ) : null}
        </div>
      </aside>
      <Outlet context={outletContext} />

      <Modal
        open={dmOpen}
        title="New direct message"
        size="lg"
        onClose={() => {
          setDmOpen(false);
          setModalError('');
        }}
      >
        <p className="muted modal-lead">
          Pick someone from the workspace to start a private conversation.
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
        title="Create a channel"
        size="lg"
        onClose={() => {
          setGroupOpen(false);
          setGroupMembers([]);
          setGroupVisibility('private');
          setGroupAnnounceOnly(false);
          setModalError('');
        }}
      >
        <form className="modal-form" onSubmit={(event) => void startGroup(event)}>
          <label>
            Channel name
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              required
              maxLength={120}
              placeholder="product-launch"
            />
          </label>
          <label>
            Visibility
            <select
              value={groupVisibility}
              onChange={(event) =>
                setGroupVisibility(event.target.value as 'public' | 'private')
              }
            >
              <option value="private">Private — invite only</option>
              <option value="public">Public — anyone in workspace can join</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={groupAnnounceOnly}
              onChange={(event) => setGroupAnnounceOnly(event.target.checked)}
            />{' '}
            Announce-only (admins post, members read)
          </label>
          <div className="modal-section">
            <p className="muted">
              {groupMembers.length === 0
                ? 'Optional — add people now, or invite later'
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
            disabled={busy || !groupName.trim()}
          >
            Create channel
          </button>
        </form>
      </Modal>

      <Modal
        open={browseOpen}
        title="Browse public channels"
        onClose={() => {
          setBrowseOpen(false);
          setModalError('');
        }}
      >
        {browseBusy ? <p className="muted">Loading…</p> : null}
        {!browseBusy && publicChannels.length === 0 ? (
          <p className="muted">No public channels to join right now.</p>
        ) : null}
        <ul className="member-list">
          {publicChannels.map((channel) => (
            <li key={channel.id}>
              <span>#{channel.name?.replace(/^#/, '')}</span>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => void joinPublicChannel(channel.id)}
              >
                Join
              </button>
            </li>
          ))}
        </ul>
        {modalError ? <p className="error">{modalError}</p> : null}
      </Modal>

      <Modal
        open={threadsOpen}
        title="Threads"
        onClose={() => {
          setThreadsOpen(false);
          setModalError('');
        }}
      >
        {threadsBusy ? <p className="muted">Loading threads…</p> : null}
        {!threadsBusy && threadItems.length === 0 ? (
          <p className="muted">
            Open or reply in a thread and it will show up here. Unfollow any
            thread you no longer need.
          </p>
        ) : null}
        <ul className="threads-home-list">
          {threadItems.map((item) => {
            const channelLabel =
              item.conversationType === 'group'
                ? `#${(item.conversationName ?? 'channel').replace(/^#/, '')}`
                : item.conversationName || 'Direct message';
            const latest = item.latestReply ?? item.root;
            const unread = (item.unreadCount ?? 0) > 0;
            return (
              <li key={item.root.id}>
                <button
                  type="button"
                  className={`threads-home-row${unread ? ' unread' : ''}`}
                  onClick={() => {
                    setThreadsOpen(false);
                    navigate(
                      `/chat/${item.conversationId}?thread=${item.root.id}`,
                    );
                  }}
                >
                  <div className="threads-home-meta">
                    <strong>{channelLabel}</strong>
                    <span className="muted">
                      {unread ? (
                        <span className="inbox-unread-pill">
                          {item.unreadCount}
                        </span>
                      ) : null}{' '}
                      {item.replyCount}{' '}
                      {item.replyCount === 1 ? 'reply' : 'replies'}
                    </span>
                  </div>
                  <p className="threads-home-snippet">
                    {displayName(byUserId.get(item.root.senderId))}:{' '}
                    {messageSnippet(item.root, me)}
                  </p>
                  <p className="threads-home-snippet muted">
                    Latest · {displayName(byUserId.get(latest.senderId))}:{' '}
                    {messageSnippet(latest, me)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
        {modalError ? <p className="error">{modalError}</p> : null}
      </Modal>

      <Modal
        open={laterOpen}
        title="Later"
        onClose={() => {
          setLaterOpen(false);
          setModalError('');
        }}
      >
        {laterBusy ? <p className="muted">Loading reminders…</p> : null}
        {!laterBusy && laterItems.length === 0 ? (
          <p className="muted">
            Remind yourself from any message&apos;s ⋮ menu. Pending reminders
            show up here until they fire.
          </p>
        ) : null}
        <ul className="threads-home-list later-inbox-list">
          {laterItems.map((item) => {
            const channelLabel =
              item.conversationType === 'group'
                ? `#${(item.conversationName ?? 'channel').replace(/^#/, '')}`
                : item.conversationName?.trim() || 'Direct message';
            return (
              <li key={item.id}>
                <div className="later-inbox-row">
                  <button
                    type="button"
                    className="threads-home-row"
                    onClick={() => {
                      setLaterOpen(false);
                      navigate(
                        `/chat/${item.conversationId}?focus=${item.messageId}`,
                      );
                    }}
                  >
                    <div className="threads-home-meta">
                      <strong>{channelLabel}</strong>
                      <span className="muted">
                        {formatScheduleWhen(item.remindAt)}
                      </span>
                    </div>
                    <p className="threads-home-snippet">
                      {item.bodySnippet?.trim() || 'Saved message'}
                    </p>
                  </button>
                  <button
                    type="button"
                    className="ghost later-cancel-btn"
                    onClick={() => void cancelLaterReminder(item.id)}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {modalError ? <p className="error">{modalError}</p> : null}
      </Modal>
    </div>
  );
}
