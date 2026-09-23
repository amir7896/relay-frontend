import { FormEvent, MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useChatSocket } from '../../chat/ChatSocketContext';
import { useVoiceCall } from '../../calls/VoiceCallContext';
import { HuddleIcon } from '../../components/HuddleIcon';
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
import { notify, subscribeWebPush, shouldShowNotificationBanner, dismissNotificationPrompt, loadNotificationPrefs, getMessageNotifyDecision } from '../../lib/notifications';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { CommandPaletteHintButton } from '../../components/CommandPalette';
import { clearMessageDraft } from '../../lib/messageDrafts';
import {
  extractSlackMentionIds,
  resolveSlackMentions,
} from '../../lib/chatComposer';
import { useDirectory } from '../../people/useDirectory';
import { UserAvatar } from '../../components/UserAvatar';
import { useOrganization } from '../../organizations/OrganizationContext';
import { WikiView } from './WikiView';
import { IncidentsView } from './IncidentsView';
import type { MessengerOutletContext } from './messengerTypes';
import type {
  BookmarkCollection,
  ChatMessage,
  Conversation,
  GlobalSearchHit,
  MessageBookmark,
  MessageReminder,
  Paginated,
  PresenceStatus,
  SidebarSection,
  MentionActivity,
  DraftInboxItem,
  ScheduledMessage,
  ThreadSummary,
  UserNotification,
  UserProfile,
} from '../../api/types';

type HomeView =
  | 'unreads'
  | 'activity'
  | 'drafts'
  | 'threads'
  | 'later'
  | 'wiki'
  | 'incidents';

export type { MessengerOutletContext } from './messengerTypes';

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

function messageSnippet(
  message: ChatMessage,
  me?: string,
  labelForUserId?: (userId: string) => string,
) {
  return singleLinePreview(previewText(message, me, labelForUserId) ?? 'Message');
}

function singleLinePreview(text: string, max = 140) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function InboxListRow({
  className = '',
  onClick,
  children,
}: {
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`home-feed-row${className ? ` ${className}` : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
}

function previewText(
  message: ChatMessage | null | undefined,
  me?: string,
  labelForUserId?: (userId: string) => string,
) {
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
  const resolved = labelForUserId
    ? resolveSlackMentions(message.body, labelForUserId)
    : message.body;
  const body = resolved.length > 64 ? `${resolved.slice(0, 64)}…` : resolved;
  return `${prefix}${body}`;
}

function normalizeConversation(item: Conversation): Conversation {
  return {
    ...item,
    muted: Boolean(item.muted),
    pinned: Boolean(item.pinned),
    pinnedAt: item.pinnedAt ?? null,
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
  const { people, byUserId, error: directoryError, ensureProfiles, refreshDirectory } =
    useDirectory();
  const mentionLabel = useCallback(
    (userId: string) => displayName(byUserId.get(userId)),
    [byUserId],
  );
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
  const [homeView, setHomeView] = useState<HomeView | null>(null);
  const [threadItems, setThreadItems] = useState<ThreadSummary[]>([]);
  const [threadsBusy, setThreadsBusy] = useState(false);
  const [threadsUnreadTotal, setThreadsUnreadTotal] = useState(0);
  const [activityTab, setActivityTab] = useState<'mentions' | 'threads' | 'assigned'>(
    'mentions',
  );
  const [mentionItems, setMentionItems] = useState<MentionActivity[]>([]);
  const [mentionsBusy, setMentionsBusy] = useState(false);
  const [mentionsUnreadTotal, setMentionsUnreadTotal] = useState(0);
  const [assignmentItems, setAssignmentItems] = useState<UserNotification[]>([]);
  const [assignmentsBusy, setAssignmentsBusy] = useState(false);
  const [assignmentsUnreadTotal, setAssignmentsUnreadTotal] = useState(0);
  const [draftItems, setDraftItems] = useState<DraftInboxItem[]>([]);
  const [draftsBusy, setDraftsBusy] = useState(false);
  const [draftsCount, setDraftsCount] = useState(0);
  const [draftsTab, setDraftsTab] = useState<'drafts' | 'scheduled'>('drafts');
  const [scheduledInboxItems, setScheduledInboxItems] = useState<
    ScheduledMessage[]
  >([]);
  const [scheduledBusy, setScheduledBusy] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [laterTab, setLaterTab] = useState<'later' | 'saved'>('later');
  const [laterQuery, setLaterQuery] = useState('');
  const [laterItems, setLaterItems] = useState<MessageReminder[]>([]);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<MessageBookmark[]>([]);
  const [savedTotalCount, setSavedTotalCount] = useState(0);
  const [bookmarkCollections, setBookmarkCollections] = useState<
    BookmarkCollection[]
  >([]);
  const [savedFolderId, setSavedFolderId] = useState<string | 'all' | 'none'>(
    'all',
  );
  const [newFolderName, setNewFolderName] = useState('');
  const [laterBusy, setLaterBusy] = useState(false);
  const [savedBusy, setSavedBusy] = useState(false);
  const [unreadsBusy, setUnreadsBusy] = useState(false);
  const [sidebarSections, setSidebarSections] = useState<SidebarSection[]>([]);
  const [sidebarBusy, setSidebarBusy] = useState(false);
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(
    null,
  );
  const [draggingConversationId, setDraggingConversationId] = useState<
    string | null
  >(null);
  const dragConversationRef = useRef<{
    id: string;
    scope: string;
  } | null>(null);
  const suppressChatNavClickRef = useRef(false);
  /** Manual order for unsectioned Channels / DMs (persisted locally). */
  const [poolChannelOrder, setPoolChannelOrder] = useState<string[]>([]);
  const [poolDmOrder, setPoolDmOrder] = useState<string[]>([]);
  const [starredCollapsed, setStarredCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notifyBanner, setNotifyBanner] = useState(false);
  const { showBanner: showInstallBanner, install, dismissBanner: dismissInstall } =
    usePwaInstall();
  const { subscribe, leaveConversation } = useChatSocket();
  const { lobbiesByConversation } = useVoiceCall();
  const itemsRef = useRef<Conversation[]>([]);
  itemsRef.current = items;
  const myStatusRef = useRef<PresenceStatus>('online');
  const byUserIdRef = useRef(byUserId);
  byUserIdRef.current = byUserId;
  /** Conversation id holding Slack-style mark-unread until the user leaves it. */
  const holdUnreadRef = useRef<string | null>(null);

  const clearUnread = useCallback((conversationId: string) => {
    if (holdUnreadRef.current === conversationId) {
      return;
    }
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

  const setUnread = useCallback(
    (
      conversationId: string,
      unreadCount: number,
      opts?: { firstUnreadMessageId?: string | null },
    ) => {
      const count = Math.max(0, unreadCount);
      holdUnreadRef.current = conversationId;
      setItems((current) =>
        current.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                unreadCount: count,
                hasUnreadMention:
                  count > 0 ? item.hasUnreadMention : false,
                firstUnreadMentionMessageId:
                  count > 0
                    ? (opts?.firstUnreadMessageId ??
                      item.firstUnreadMentionMessageId)
                    : null,
              }
            : item,
        ),
      );
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const response = await api<Paginated<Conversation>>(
        '/chat/conversations?page=1&limit=50',
      );
      const activeId = activeIdRef.current;
      setItems(
        response.data.items.map((item) => {
          const normalized = normalizeConversation(item);
          if (
            item.id === activeId &&
            holdUnreadRef.current !== activeId
          ) {
            return {
              ...normalized,
              unreadCount: 0,
              hasUnreadMention: false,
              firstUnreadMentionMessageId: null,
            };
          }
          return normalized;
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
    const notifyDecision = getMessageNotifyDecision({
      conversationId: message.conversationId,
      mentionsMe,
      muted: Boolean(existing?.muted),
      body: message.body,
      myStatus: myStatusRef.current,
    });
    // Slack-style: muted / mentions-only / keywords handled in getMessageNotifyDecision.
    const shouldNotify =
      Boolean(existing) &&
      fromOther &&
      isBrandNew &&
      isLatestUpdate &&
      notifyDecision.notify;

    if (
      existing &&
      existing.id !== activeId &&
      fromOther &&
      mentionsMe &&
      isBrandNew &&
      isLatestUpdate
    ) {
      setMentionsUnreadTotal((count) => count + 1);
      setMentionItems((current) => {
        const next: MentionActivity = {
          conversationId: existing.id,
          conversationName: existing.name,
          conversationType: existing.type,
          message,
          unread: true,
        };
        return [
          next,
          ...current.filter((item) => item.message.id !== message.id),
        ].slice(0, 40);
      });
    }

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
    const title = mentionsMe
      ? `${chatTitle} · mentioned you`
      : notifyDecision.matchedKeyword
        ? `${chatTitle} · keyword match`
        : chatTitle;
    const preview =
      message.attachment && message.type === 'image'
        ? 'Sent a photo'
        : resolveSlackMentions(
            message.body || 'New message',
            (userId) => displayName(byUserIdRef.current.get(userId)),
          );
    const body = mentionsMe
      ? preview.startsWith('@')
        ? preview
        : `Mention: ${preview}`
      : notifyDecision.matchedKeyword
        ? `Keyword: ${preview}`
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

  const refreshLater = useCallback(async () => {
    try {
      const response = await api<Paginated<MessageReminder>>(
        '/chat/reminders?page=1&limit=100&scope=all',
      );
      setLaterItems(response.data.items ?? []);
    } catch {
      // ignore badge errors
    }
  }, []);

  const refreshThreadsUnread = useCallback(async () => {
    try {
      const response = await api<Paginated<ThreadSummary>>(
        '/chat/threads?page=1&limit=40',
      );
      const unread = (response.data.items ?? []).reduce(
        (sum, item) => sum + (item.unreadCount ?? 0),
        0,
      );
      setThreadsUnreadTotal(unread);
    } catch {
      // ignore badge errors
    }
  }, []);

  const refreshSaved = useCallback(async () => {
    try {
      const folderQuery =
        savedFolderId === 'all'
          ? ''
          : savedFolderId === 'none'
            ? '&collectionId=none'
            : `&collectionId=${encodeURIComponent(savedFolderId)}`;
      const [bookmarksRes, collectionsRes, allRes] = await Promise.all([
        api<Paginated<MessageBookmark>>(
          `/chat/bookmarks?page=1&limit=100${folderQuery}`,
        ),
        api<BookmarkCollection[]>('/chat/bookmark-collections'),
        savedFolderId === 'all'
          ? Promise.resolve(null)
          : api<Paginated<MessageBookmark>>('/chat/bookmarks?page=1&limit=100'),
      ]);
      setSavedItems(bookmarksRes.data.items ?? []);
      if (savedFolderId === 'all') {
        setSavedTotalCount(bookmarksRes.data.items?.length ?? 0);
      } else {
        setSavedTotalCount(allRes?.data.items?.length ?? 0);
      }
      setBookmarkCollections(
        Array.isArray(collectionsRes.data) ? collectionsRes.data : [],
      );
    } catch {
      // ignore
    }
  }, [savedFolderId]);

  useEffect(() => {
    if (laterTab !== 'saved') return;
    void refreshSaved();
  }, [savedFolderId, laterTab, refreshSaved]);

  async function createSavedFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const response = await api<BookmarkCollection>(
        '/chat/bookmark-collections',
        {
          method: 'POST',
          body: JSON.stringify({ name }),
        },
      );
      setBookmarkCollections((current) => [response.data, ...current]);
      setNewFolderName('');
      setSavedFolderId(response.data.id);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not create folder',
      );
    }
  }

  async function deleteSavedFolder(collectionId: string) {
    try {
      await api(`/chat/bookmark-collections/${collectionId}`, {
        method: 'DELETE',
      });
      setBookmarkCollections((current) =>
        current.filter((item) => item.id !== collectionId),
      );
      if (savedFolderId === collectionId) setSavedFolderId('all');
      await refreshSaved();
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not delete folder',
      );
    }
  }

  async function renameSavedFolder(collectionId: string, currentName: string) {
    const next = window.prompt('Rename folder', currentName)?.trim();
    if (!next || next === currentName) return;
    try {
      const response = await api<BookmarkCollection>(
        `/chat/bookmark-collections/${collectionId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: next }),
        },
      );
      setBookmarkCollections((current) =>
        current.map((item) =>
          item.id === collectionId ? { ...item, ...response.data } : item,
        ),
      );
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not rename folder',
      );
    }
  }

  async function moveSavedToFolder(
    messageId: string,
    collectionId: string | null,
  ) {
    try {
      const response = await api<MessageBookmark>(
        `/chat/bookmarks/${messageId}/collection`,
        {
          method: 'PATCH',
          body: JSON.stringify({ collectionId }),
        },
      );
      setSavedItems((current) => {
        const next = current.map((item) =>
          item.messageId === messageId
            ? { ...item, collectionId: response.data.collectionId ?? null }
            : item,
        );
        if (savedFolderId === 'all') return next;
        if (savedFolderId === 'none') {
          return next.filter((item) => !item.collectionId);
        }
        return next.filter((item) => item.collectionId === savedFolderId);
      });
      await refreshSaved();
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not move saved message',
      );
    }
  }

  useEffect(() => {
    if (activeConversationId) {
      setHomeView(null);
    }
  }, [activeConversationId]);

  const laterPendingCount = useMemo(
    () => laterItems.filter((item) => item.status === 'pending').length,
    [laterItems],
  );

  const unreadConversations = useMemo(() => {
    return items
      .filter(
        (item) =>
          (item.unreadCount ?? 0) > 0 || Boolean(item.hasUnreadMention),
      )
      .slice()
      .sort((a, b) => {
        const aMention = a.hasUnreadMention ? 1 : 0;
        const bMention = b.hasUnreadMention ? 1 : 0;
        if (aMention !== bMention) return bMention - aMention;
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [items]);

  const unreadsTotal = useMemo(
    () =>
      unreadConversations.reduce(
        (sum, item) => sum + Math.max(1, item.unreadCount || 0),
        0,
      ),
    [unreadConversations],
  );

  const unreadChannels = useMemo(
    () => unreadConversations.filter((item) => item.type === 'group'),
    [unreadConversations],
  );

  const unreadDms = useMemo(
    () => unreadConversations.filter((item) => item.type === 'private'),
    [unreadConversations],
  );

  const laterSections = useMemo(() => {
    const now = Date.now();
    const overdue: MessageReminder[] = [];
    const upcoming: MessageReminder[] = [];
    const completed: MessageReminder[] = [];
    const q = laterQuery.trim().toLowerCase();
    for (const item of laterItems) {
      if (q) {
        const hay = `${item.bodySnippet ?? ''} ${item.conversationName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (item.status === 'completed' || item.status === 'sent') {
        completed.push(item);
        continue;
      }
      if (item.status !== 'pending') continue;
      if (new Date(item.remindAt).getTime() <= now) overdue.push(item);
      else upcoming.push(item);
    }
    return { overdue, upcoming, completed };
  }, [laterItems, laterQuery]);

  const filteredSavedItems = useMemo(() => {
    const q = laterQuery.trim().toLowerCase();
    if (!q) return savedItems;
    return savedItems.filter((item) => {
      const title =
        item.conversationName?.trim() ||
        (item.conversationType === 'group' ? 'channel' : 'direct message');
      const snippet =
        item.message?.body?.trim() ||
        item.message?.attachment?.name ||
        '';
      const folder =
        bookmarkCollections.find((row) => row.id === item.collectionId)?.name ??
        '';
      return `${title} ${snippet} ${folder}`.toLowerCase().includes(q);
    });
  }, [savedItems, laterQuery, bookmarkCollections]);

  useEffect(() => {
    let cancelled = false;
    async function refreshThreadBadge() {
      if (cancelled) return;
      await refreshThreadsUnread();
    }
    async function refreshMentionsBadge() {
      try {
        const response = await api<Paginated<MentionActivity>>(
          '/chat/mentions?page=1&limit=40',
        );
        if (cancelled) return;
        const items = response.data.items ?? [];
        setMentionItems(items);
        setMentionsUnreadTotal(items.filter((item) => item.unread).length);
      } catch {
        // ignore
      }
    }
    async function refreshAssignmentsBadge() {
      try {
        const response = await api<{ count: number }>(
          '/chat/notifications/unread-count',
        );
        if (cancelled) return;
        setAssignmentsUnreadTotal(response.data.count ?? 0);
      } catch {
        // ignore
      }
    }
    async function refreshDraftsBadge() {
      try {
        const [draftsRes, scheduledRes] = await Promise.all([
          api<Paginated<DraftInboxItem>>('/chat/drafts?page=1&limit=40'),
          api<Paginated<ScheduledMessage>>(
            '/chat/scheduled-messages?page=1&limit=40',
          ),
        ]);
        if (cancelled) return;
        const drafts = (draftsRes.data.items ?? []).filter((item) =>
          item.body.trim(),
        );
        setDraftItems(drafts);
        setDraftsCount(drafts.length);
        const scheduled = scheduledRes.data.items ?? [];
        setScheduledInboxItems(scheduled);
        setScheduledCount(scheduled.length);
      } catch {
        // ignore
      }
    }
    async function refreshLaterBadge() {
      try {
        const response = await api<Paginated<MessageReminder>>(
          '/chat/reminders?page=1&limit=100&scope=all',
        );
        if (cancelled) return;
        setLaterItems(response.data.items ?? []);
      } catch {
        // ignore
      }
    }
    async function refreshSavedBadge() {
      try {
        const response = await api<Paginated<MessageBookmark>>(
          '/chat/bookmarks?page=1&limit=100',
        );
        if (cancelled) return;
        setSavedTotalCount((response.data.items ?? []).length);
      } catch {
        // ignore
      }
    }
    void refreshThreadBadge();
    void refreshMentionsBadge();
    void refreshAssignmentsBadge();
    void refreshDraftsBadge();
    void refreshLaterBadge();
    void refreshSavedBadge();
    return () => {
      cancelled = true;
    };
  }, [refreshThreadsUnread]);

  useEffect(() => {
    setNotifyBanner(shouldShowNotificationBanner());
    void loadNotificationPrefs();
  }, []);

  useEffect(() => {
    let pendingCommand: string | null = null;
    let timer: number | undefined;
    function onComposerSlash(event: Event) {
      const detail = (event as CustomEvent<{ command?: string }>).detail;
      const command = detail?.command?.trim();
      if (!command) return;
      if (activeIdRef.current) {
        pendingCommand = null;
        return;
      }
      if (pendingCommand === command) return;
      const target =
        itemsRef.current.find((item) => item.type === 'group')?.id ??
        itemsRef.current[0]?.id;
      if (!target) return;
      pendingCommand = command;
      navigate(`/chat/${target}`);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        pendingCommand = null;
        window.dispatchEvent(
          new CustomEvent('relay:composer-slash', {
            detail: { command },
          }),
        );
      }, 160);
    }
    window.addEventListener('relay:composer-slash', onComposerSlash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('relay:composer-slash', onComposerSlash);
    };
  }, [navigate]);

  useEffect(() => {
    if (
      holdUnreadRef.current &&
      holdUnreadRef.current !== activeConversationId
    ) {
      holdUnreadRef.current = null;
    }
    if (!activeConversationId) {
      return;
    }
    clearUnread(activeConversationId);
  }, [activeConversationId, clearUnread]);

  useEffect(() => {
    const unsubs = [
      subscribe('chat:message', (payload) => {
        const message = payload as ChatMessage;
        applyInboxMessage(message);
        if (message.threadRootId) {
          void refreshThreadsUnread();
        }
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
      subscribe('chat:reminder', () => {
        void refreshLater();
      }),
      subscribe('chat:notification', (payload) => {
        const notification = payload as UserNotification;
        setAssignmentItems((current) => {
          if (current.some((item) => item.id === notification.id)) {
            return current;
          }
          return [notification, ...current];
        });
        if (notification.unread !== false) {
          setAssignmentsUnreadTotal((count) => count + 1);
        }
        notify({
          title: notification.title || 'Task assigned to you',
          body: notification.body || 'A list task was assigned to you',
          tag: `assignment-${notification.id}`,
        });
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
  }, [applyInboxMessage, leaveConversation, navigate, refreshLater, refreshThreadsUnread, subscribe]);

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

  const poolOrderStorageKey = useMemo(() => {
    if (!me || !activeOrganizationId) return null;
    return `relay:sidebar-pool-order:${activeOrganizationId}:${me}`;
  }, [me, activeOrganizationId]);

  useEffect(() => {
    if (!poolOrderStorageKey) {
      setPoolChannelOrder([]);
      setPoolDmOrder([]);
      return;
    }
    try {
      const raw = localStorage.getItem(poolOrderStorageKey);
      if (!raw) {
        setPoolChannelOrder([]);
        setPoolDmOrder([]);
        return;
      }
      const parsed = JSON.parse(raw) as {
        channels?: unknown;
        dms?: unknown;
      };
      setPoolChannelOrder(
        Array.isArray(parsed.channels)
          ? parsed.channels.filter((id): id is string => typeof id === 'string')
          : [],
      );
      setPoolDmOrder(
        Array.isArray(parsed.dms)
          ? parsed.dms.filter((id): id is string => typeof id === 'string')
          : [],
      );
    } catch {
      setPoolChannelOrder([]);
      setPoolDmOrder([]);
    }
  }, [poolOrderStorageKey]);

  function persistPoolOrder(channelsOrder: string[], dmsOrder: string[]) {
    if (!poolOrderStorageKey) return;
    try {
      localStorage.setItem(
        poolOrderStorageKey,
        JSON.stringify({ channels: channelsOrder, dms: dmsOrder }),
      );
    } catch {
      // ignore quota / private mode
    }
  }

  function applyPoolOrder(
    list: Conversation[],
    orderIds: string[],
  ): Conversation[] {
    if (list.length <= 1 || orderIds.length === 0) return list;
    const byId = new Map(list.map((item) => [item.id, item]));
    const used = new Set<string>();
    const ordered: Conversation[] = [];
    for (const id of orderIds) {
      const item = byId.get(id);
      if (item) {
        ordered.push(item);
        used.add(id);
      }
    }
    for (const item of list) {
      if (!used.has(item.id)) ordered.push(item);
    }
    return ordered;
  }

  const channels = useMemo(
    () =>
      applyPoolOrder(
        filtered.filter(
          (item) =>
            item.type === 'group' &&
            !sectionedIds.has(item.id) &&
            !item.pinned,
        ),
        poolChannelOrder,
      ),
    [filtered, sectionedIds, poolChannelOrder],
  );
  const directs = useMemo(
    () =>
      applyPoolOrder(
        filtered.filter(
          (item) =>
            item.type === 'private' &&
            !sectionedIds.has(item.id) &&
            !item.pinned,
        ),
        poolDmOrder,
      ),
    [filtered, sectionedIds, poolDmOrder],
  );
  const starredItems = useMemo(() => {
    return filtered
      .filter((item) => item.pinned && !sectionedIds.has(item.id))
      .sort((a, b) => {
        const aTime = a.pinnedAt ? Date.parse(a.pinnedAt) : 0;
        const bTime = b.pinnedAt ? Date.parse(b.pinnedAt) : 0;
        if (aTime !== bTime) return bTime - aTime;
        const aMsg = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
        const bMsg = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
        return bMsg - aMsg;
      });
  }, [filtered, sectionedIds]);

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

  useEffect(() => {
    function navList() {
      return items;
    }

    function stepChannel(delta: number) {
      const list = navList();
      if (list.length === 0) return;
      const currentId = activeIdRef.current;
      const index = currentId
        ? list.findIndex((item) => item.id === currentId)
        : -1;
      const nextIndex =
        index < 0
          ? delta > 0
            ? 0
            : list.length - 1
          : (index + delta + list.length) % list.length;
      const next = list[nextIndex];
      if (next) {
        setHomeView(null);
        navigate(`/chat/${next.id}`);
      }
    }

    function stepUnread(delta: number) {
      const list = navList().filter(
        (item) => (item.unreadCount ?? 0) > 0 || Boolean(item.hasUnreadMention),
      );
      if (list.length === 0) {
        setHomeView('unreads');
        navigate('/chat');
        return;
      }
      const currentId = activeIdRef.current;
      const index = currentId
        ? list.findIndex((item) => item.id === currentId)
        : -1;
      let nextIndex: number;
      if (index < 0) {
        nextIndex = delta > 0 ? 0 : list.length - 1;
      } else {
        nextIndex = (index + delta + list.length) % list.length;
      }
      const next = list[nextIndex];
      if (next) {
        setHomeView(null);
        const focus = next.firstUnreadMentionMessageId;
        if (focus) {
          navigate(
            `/chat/${next.id}?focus=${encodeURIComponent(focus)}`,
          );
        } else {
          navigate(`/chat/${next.id}`);
        }
      }
    }

    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = detail?.action;
      if (action === 'new-channel') {
        setModalError('');
        setGroupMembers([]);
        setGroupName('');
        setGroupVisibility('private');
        setGroupAnnounceOnly(false);
        setGroupOpen(true);
        void refreshDirectory();
      } else if (action === 'new-dm') {
        setModalError('');
        setDmOpen(true);
        void refreshDirectory();
      } else if (action === 'unreads' || action === 'open-unreads') {
        setHomeView('unreads');
        setModalError('');
        navigate('/chat');
      } else if (action === 'open-threads') {
        void openThreadsHome();
      } else if (action === 'open-later') {
        void openLaterInbox('later');
      } else if (action === 'open-activity') {
        void openActivityHome('mentions');
      } else if (action === 'open-drafts') {
        void openDraftsHome();
      } else if (action === 'prev-channel') {
        stepChannel(-1);
      } else if (action === 'next-channel') {
        stepChannel(1);
      } else if (action === 'prev-unread') {
        stepUnread(-1);
      } else if (action === 'next-unread') {
        stepUnread(1);
      }
    };
    window.addEventListener('relay:command', onCommand);
    return () => window.removeEventListener('relay:command', onCommand);
  }, [navigate, items, refreshDirectory]);

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
      void refreshDirectory();
    },
    openNewGroup: () => {
      setModalError('');
      setGroupMembers([]);
      setGroupName('');
      setGroupVisibility('private');
      setGroupAnnounceOnly(false);
      setGroupOpen(true);
      void refreshDirectory();
    },
    openWiki: () => {
      void openWikiInbox();
    },
    clearUnread,
    setUnread,
    refreshInbox: load,
    conversations: items,
    laterItems,
    refreshLater,
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

  async function reorderSidebarSections(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ordered = [...sidebarSections].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    const fromIndex = ordered.findIndex((row) => row.id === fromId);
    const toIndex = ordered.findIndex((row) => row.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    const withOrder = ordered.map((row, index) => ({
      ...row,
      sortOrder: index,
    }));
    setSidebarSections(withOrder);
    try {
      await Promise.all(
        withOrder.map((row) =>
          api<SidebarSection>(`/chat/sidebar/sections/${row.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ sortOrder: row.sortOrder }),
          }),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder sections');
      await loadSidebarSections();
    }
  }

  async function reorderStarredConversations(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ordered = starredItems.map((item) => item.id);
    const fromIndex = ordered.indexOf(fromId);
    const toIndex = ordered.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...ordered];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const base = Date.now();
    setItems((current) =>
      current.map((row) => {
        const index = next.indexOf(row.id);
        if (index < 0) return row;
        return {
          ...row,
          pinned: true,
          pinnedAt: new Date(base - index * 1000).toISOString(),
        };
      }),
    );
    try {
      await api('/chat/sidebar/starred-order', {
        method: 'PUT',
        body: JSON.stringify({ conversationIds: next }),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not reorder starred',
      );
    }
  }

  async function reorderSectionConversations(
    sectionId: string,
    fromId: string,
    toId: string,
  ) {
    if (fromId === toId) return;
    const section = sidebarSections.find((row) => row.id === sectionId);
    if (!section) return;
    const ordered = [...(section.conversationIds ?? [])];
    const fromIndex = ordered.indexOf(fromId);
    const toIndex = ordered.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    setSidebarSections((current) =>
      current.map((row) =>
        row.id === sectionId ? { ...row, conversationIds: ordered } : row,
      ),
    );
    try {
      const response = await api<SidebarSection>(
        `/chat/sidebar/sections/${sectionId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ conversationIds: ordered }),
        },
      );
      setSidebarSections((current) =>
        current.map((row) => (row.id === sectionId ? response.data : row)),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not reorder section chats',
      );
      await loadSidebarSections();
    }
  }

  function reorderPoolConversations(
    kind: 'channel' | 'dm',
    fromId: string,
    toId: string,
  ) {
    if (fromId === toId) return;
    const source = kind === 'channel' ? channels : directs;
    const ordered = source.map((item) => item.id);
    const fromIndex = ordered.indexOf(fromId);
    const toIndex = ordered.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...ordered];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    if (kind === 'channel') {
      setPoolChannelOrder(next);
      persistPoolOrder(next, poolDmOrder);
    } else {
      setPoolDmOrder(next);
      persistPoolOrder(poolChannelOrder, next);
    }
  }

  function sectionUnreadCount(sectionItems: Conversation[]) {
    return sectionItems.reduce((sum, item) => {
      if (item.id === activeConversationId) return sum;
      if (item.unreadCount > 0) return sum + item.unreadCount;
      if (item.hasUnreadMention) return sum + 1;
      return sum;
    }, 0);
  }

  function renderConversationRow(
    item: Conversation,
    dragScope?:
      | 'starred'
      | `section:${string}`
      | 'pool:channel'
      | 'pool:dm'
      | null,
  ) {
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
      previewText(item.lastMessage, me, mentionLabel) ??
      (item.type === 'group' ? 'Channel' : 'Direct message');
    const unread =
      item.id !== activeConversationId && item.unreadCount > 0
        ? item.unreadCount
        : 0;
    const mentionUnread =
      item.id !== activeConversationId && Boolean(item.hasUnreadMention);
    const isChannel = item.type === 'group';
    const liveLobby = lobbiesByConversation[item.id];
    const huddleLive =
      Boolean(liveLobby?.active) &&
      liveLobby?.mode === 'huddle' &&
      (liveLobby?.joinedIds.length ?? 0) > 0;
    const callLive =
      isChannel &&
      Boolean(liveLobby?.active) &&
      liveLobby?.mode !== 'huddle' &&
      (liveLobby?.joinedIds.length ?? 0) > 0;
    const canDrag = Boolean(dragScope) && !sidebarBusy;
    const canReorder =
      dragScope === 'starred' ||
      dragScope === 'pool:channel' ||
      dragScope === 'pool:dm' ||
      Boolean(dragScope?.startsWith('section:'));

    const applyConversationDrop = (targetId: string) => {
      const payload = dragConversationRef.current;
      const fromId = payload?.id;
      const fromScope = payload?.scope ?? '';
      dragConversationRef.current = null;
      setDraggingConversationId(null);
      if (!fromId || fromId === targetId || !dragScope) return;
      if (dragScope === 'starred' && fromScope === 'starred') {
        void reorderStarredConversations(fromId, targetId);
        return;
      }
      if (
        dragScope === 'pool:channel' &&
        fromScope === 'pool:channel'
      ) {
        reorderPoolConversations('channel', fromId, targetId);
        return;
      }
      if (dragScope === 'pool:dm' && fromScope === 'pool:dm') {
        reorderPoolConversations('dm', fromId, targetId);
        return;
      }
      if (dragScope.startsWith('section:') && fromScope === dragScope) {
        const sectionId = dragScope.slice('section:'.length);
        void reorderSectionConversations(sectionId, fromId, targetId);
      }
    };

    return (
      <div
        key={item.id}
        className={`chat-row-shell${
          draggingConversationId === item.id ? ' is-dragging-row' : ''
        }${canReorder ? ' is-reorderable' : ''}`}
        onDragOver={(event) => {
          if (!canReorder || !dragConversationRef.current) return;
          if (dragConversationRef.current.scope !== dragScope) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          if (!canReorder) return;
          event.preventDefault();
          event.stopPropagation();
          applyConversationDrop(item.id);
        }}
      >
        {canDrag ? (
          <button
            type="button"
            className="chat-row-grip"
            tabIndex={0}
            title={
              canReorder
                ? 'Drag to reorder'
                : 'Drag onto a section to move'
            }
            aria-label={
              canReorder ? 'Drag to reorder chat' : 'Drag chat to a section'
            }
            draggable
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
              }
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onDragStart={(event) => {
              event.stopPropagation();
              suppressChatNavClickRef.current = true;
              dragConversationRef.current = {
                id: item.id,
                scope: dragScope ?? 'pool:channel',
              };
              setDraggingConversationId(item.id);
              event.dataTransfer.setData(
                'text/plain',
                JSON.stringify({ id: item.id, scope: dragScope }),
              );
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setDraggingConversationId(null);
              window.setTimeout(() => {
                if (dragConversationRef.current?.id === item.id) {
                  dragConversationRef.current = null;
                }
                suppressChatNavClickRef.current = false;
              }, 40);
            }}
          >
            <span aria-hidden="true">⋮⋮</span>
          </button>
        ) : null}
        <NavLink
          className={`chat-row${isChannel ? ' channel-row' : ''}${
            item.muted ? ' muted-chat' : ''
          }${item.pinned ? ' pinned-chat' : ''}${
            unread || mentionUnread ? ' has-unread' : ''
          }${mentionUnread ? ' has-mention' : ''}`}
          to={`/chat/${item.id}`}
          onClick={(event) => {
            if (suppressChatNavClickRef.current) {
              event.preventDefault();
              suppressChatNavClickRef.current = false;
            }
          }}
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
              {item.isShared ? (
                <span className="connect-pill sm" title="Shared channel">
                  Shared
                </span>
              ) : null}
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
              {huddleLive ? (
                <span
                  className="chat-huddle-live"
                  title={`Huddle live · ${liveLobby?.joinedIds.length ?? 0}`}
                  aria-label="Huddle live in this channel"
                >
                  <HuddleIcon size={14} />
                </span>
              ) : callLive ? (
                <span
                  className="chat-call-live"
                  title="Call in progress"
                  aria-label="Call in progress"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 7.7 7.7 0 0 0 2.4.4 1.2 1.2 0 0 1 1.2 1.2V20a1.2 1.2 0 0 1-1.2 1.2A17.2 17.2 0 0 1 2.8 4 1.2 1.2 0 0 1 4 2.8h3.5A1.2 1.2 0 0 1 8.7 4a7.7 7.7 0 0 0 .4 2.4 1.2 1.2 0 0 1-.3 1.2z"
                    />
                  </svg>
                </span>
              ) : null}
              <button
                className={`pin-toggle${item.pinned ? ' is-pinned' : ''}`}
                type="button"
                title={item.pinned ? 'Remove from Starred' : 'Add to Starred'}
                aria-label={item.pinned ? 'Unstar' : 'Star'}
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
      </div>
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
            ? {
                ...row,
                pinned: Boolean(response.data.pinned),
                pinnedAt: response.data.pinnedAt ?? (response.data.pinned ? new Date().toISOString() : null),
              }
            : row,
        );
        return [...updated].sort((a, b) => {
          if (a.pinned !== b.pinned) {
            return Number(b.pinned) - Number(a.pinned);
          }
          if (a.pinned && b.pinned) {
            const aPin = a.pinnedAt ? Date.parse(a.pinnedAt) : 0;
            const bPin = b.pinnedAt ? Date.parse(b.pinnedAt) : 0;
            if (aPin !== bPin) return bPin - aPin;
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
      const response = await api<Paginated<Conversation>>(
        '/chat/channels/public?page=1&limit=50',
      );
      const joined = new Set(items.map((item) => item.id));
      setPublicChannels(
        (response.data.items ?? [])
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

  async function loadThreadsHome() {
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
        err instanceof Error ? err.message : 'Could not load following',
      );
      setThreadItems([]);
    } finally {
      setThreadsBusy(false);
    }
  }

  async function unfollowThreadHome(
    conversationId: string,
    threadRootId: string,
  ) {
    try {
      const existing = threadItems.find((item) => item.root.id === threadRootId);
      const unreadDelta = existing?.unreadCount ?? (existing?.hasUnread ? 1 : 0);
      await api(
        `/chat/conversations/${conversationId}/threads/${threadRootId}/follow`,
        { method: 'DELETE' },
      );
      setThreadItems((current) =>
        current.filter((item) => item.root.id !== threadRootId),
      );
      setThreadsUnreadTotal((count) => Math.max(0, count - unreadDelta));
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not unfollow thread',
      );
    }
  }

  async function openThreadsHome() {
    setHomeView('threads');
    setModalError('');
    if (activeIdRef.current) navigate('/chat');
    await loadThreadsHome();
  }

  async function loadMentionsHome() {
    setMentionsBusy(true);
    try {
      const response = await api<Paginated<MentionActivity>>(
        '/chat/mentions?page=1&limit=40',
      );
      const items = response.data.items ?? [];
      setMentionItems(items);
      setMentionsUnreadTotal(items.filter((item) => item.unread).length);
      const profileIds = new Set<string>();
      for (const item of items) {
        profileIds.add(item.message.senderId);
        for (const mentionId of item.message.mentions ?? []) {
          profileIds.add(mentionId);
        }
        for (const mentionId of extractSlackMentionIds(item.message.body ?? '')) {
          profileIds.add(mentionId);
        }
      }
      await ensureProfiles([...profileIds]);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not load mentions',
      );
      setMentionItems([]);
    } finally {
      setMentionsBusy(false);
    }
  }

  async function loadAssignedHome() {
    setAssignmentsBusy(true);
    try {
      const response = await api<Paginated<UserNotification>>(
        '/chat/notifications?page=1&limit=40',
      );
      const items = response.data.items ?? [];
      setAssignmentItems(items);
      setAssignmentsUnreadTotal(items.filter((item) => item.unread).length);
      await ensureProfiles(items.map((item) => item.actorId));
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not load assignments',
      );
      setAssignmentItems([]);
    } finally {
      setAssignmentsBusy(false);
    }
  }

  async function markAssignmentRead(notification: UserNotification) {
    if (!notification.unread) return;
    setAssignmentItems((current) =>
      current.map((item) =>
        item.id === notification.id
          ? { ...item, unread: false, readAt: new Date().toISOString() }
          : item,
      ),
    );
    setAssignmentsUnreadTotal((count) => Math.max(0, count - 1));
    try {
      await api(`/chat/notifications/${notification.id}/read`, {
        method: 'POST',
      });
    } catch {
      // ignore — list will refresh later
    }
  }

  async function markAllAssignmentsRead() {
    setAssignmentItems((current) =>
      current.map((item) => ({
        ...item,
        unread: false,
        readAt: item.readAt ?? new Date().toISOString(),
      })),
    );
    setAssignmentsUnreadTotal(0);
    try {
      await api('/chat/notifications/read-all', { method: 'POST' });
    } catch {
      // ignore
    }
  }

  async function openActivityHome(
    tab: 'mentions' | 'threads' | 'assigned' = 'mentions',
  ) {
    setActivityTab(tab);
    setHomeView('activity');
    setModalError('');
    if (activeIdRef.current) navigate('/chat');
    if (tab === 'mentions') {
      await loadMentionsHome();
    } else if (tab === 'assigned') {
      await loadAssignedHome();
    } else {
      await loadThreadsHome();
    }
  }

  async function openDraftsHome(tab: 'drafts' | 'scheduled' = 'drafts') {
    setDraftsTab(tab);
    setHomeView('drafts');
    setModalError('');
    if (activeIdRef.current) navigate('/chat');
    setDraftsBusy(true);
    setScheduledBusy(true);
    try {
      const [draftsRes, scheduledRes] = await Promise.all([
        api<Paginated<DraftInboxItem>>('/chat/drafts?page=1&limit=40'),
        api<Paginated<ScheduledMessage>>(
          '/chat/scheduled-messages?page=1&limit=40',
        ),
      ]);
      const drafts = (draftsRes.data.items ?? []).filter((item) =>
        item.body.trim(),
      );
      const scheduled = scheduledRes.data.items ?? [];
      setDraftItems(drafts);
      setDraftsCount(drafts.length);
      setScheduledInboxItems(scheduled);
      setScheduledCount(scheduled.length);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not load drafts',
      );
      setDraftItems([]);
      setScheduledInboxItems([]);
    } finally {
      setDraftsBusy(false);
      setScheduledBusy(false);
    }
  }

  async function cancelScheduledInboxItem(item: ScheduledMessage) {
    try {
      await api(
        `/chat/conversations/${item.conversationId}/scheduled-messages/${item.id}`,
        { method: 'DELETE' },
      );
      setScheduledInboxItems((current) => {
        const next = current.filter((row) => row.id !== item.id);
        setScheduledCount(next.length);
        return next;
      });
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not cancel scheduled message',
      );
    }
  }

  function openUnreadsHome() {
    setHomeView('unreads');
    setModalError('');
    if (activeIdRef.current) navigate('/chat');
  }

  function openUnreadConversation(conversation: Conversation) {
    setHomeView(null);
    const focusId = conversation.firstUnreadMentionMessageId;
    if (focusId) {
      navigate(
        `/chat/${conversation.id}?focus=${encodeURIComponent(focusId)}`,
      );
      return;
    }
    navigate(`/chat/${conversation.id}`);
  }

  async function markConversationRead(conversationId: string) {
    try {
      await api(`/chat/conversations/${conversationId}/seen`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch {
      // Still clear locally so the Unreads feed updates
    }
    if (holdUnreadRef.current === conversationId) {
      holdUnreadRef.current = null;
    }
    clearUnread(conversationId);
  }

  async function markAllUnreadsRead() {
    if (unreadConversations.length === 0 || unreadsBusy) return;
    setUnreadsBusy(true);
    setModalError('');
    try {
      const ids = unreadConversations.map((item) => item.id);
      await Promise.all(
        ids.map((conversationId) =>
          api(`/chat/conversations/${conversationId}/seen`, {
            method: 'POST',
            body: JSON.stringify({}),
          }).catch(() => null),
        ),
      );
      holdUnreadRef.current = null;
      setItems((current) =>
        current.map((item) =>
          ids.includes(item.id)
            ? {
                ...item,
                unreadCount: 0,
                hasUnreadMention: false,
                firstUnreadMentionMessageId: null,
              }
            : item,
        ),
      );
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not mark all as read',
      );
    } finally {
      setUnreadsBusy(false);
    }
  }

  async function discardDraft(conversationId: string) {
    try {
      clearMessageDraft(conversationId);
      setDraftItems((current) => {
        const next = current.filter(
          (item) => item.conversationId !== conversationId,
        );
        setDraftsCount(next.length);
        return next;
      });
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not discard draft',
      );
    }
  }

  async function openLaterInbox(tab: 'later' | 'saved' = 'later') {
    setLaterTab(tab);
    setLaterQuery('');
    setHomeView('later');
    setModalError('');
    if (activeIdRef.current) navigate('/chat');
    setLaterBusy(true);
    setSavedBusy(true);
    try {
      await Promise.all([refreshLater(), refreshSaved()]);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not load Later',
      );
    } finally {
      setLaterBusy(false);
      setSavedBusy(false);
    }
  }

  function openWikiInbox() {
    setHomeView('wiki');
    setModalError('');
    if (activeIdRef.current) navigate('/chat');
  }

  function openIncidentsInbox() {
    setHomeView('incidents');
    setModalError('');
    if (activeIdRef.current) navigate('/chat');
  }

  function remindAtInOneHour() {
    return new Date(Date.now() + 60 * 60 * 1000);
  }

  function remindAtTomorrowMorning() {
    const when = new Date();
    when.setDate(when.getDate() + 1);
    when.setHours(9, 0, 0, 0);
    return when;
  }

  async function snoozeLaterReminder(item: MessageReminder, when: Date) {
    setSnoozingId(item.id);
    setModalError('');
    try {
      await api<MessageReminder>(
        `/chat/conversations/${item.conversationId}/messages/${item.messageId}/remind`,
        {
          method: 'POST',
          body: JSON.stringify({ remindAt: when.toISOString() }),
        },
      );
      await refreshLater();
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not snooze reminder',
      );
    } finally {
      setSnoozingId(null);
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

  async function completeLaterReminder(reminderId: string) {
    try {
      const response = await api<MessageReminder>(
        `/chat/reminders/${reminderId}/complete`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setLaterItems((current) =>
        current.map((item) =>
          item.id === reminderId ? { ...item, ...response.data } : item,
        ),
      );
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not complete reminder',
      );
    }
  }

  async function clearCompletedLater() {
    try {
      await api('/chat/reminders/completed', { method: 'DELETE' });
      setLaterItems((current) =>
        current.filter(
          (item) => item.status !== 'completed' && item.status !== 'sent',
        ),
      );
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not clear completed',
      );
    }
  }

  async function unsaveBookmark(messageId: string) {
    try {
      await api(`/chat/bookmarks/${messageId}`, { method: 'DELETE' });
      setSavedItems((current) =>
        current.filter((item) => item.messageId !== messageId),
      );
      setSavedTotalCount((count) => Math.max(0, count - 1));
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : 'Could not unsave message',
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
        homeView ? 'has-home' : '',
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
            <CommandPaletteHintButton />
        <input
          className="inbox-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter channels…"
              aria-label="Filter channels and messages"
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
          <nav className="inbox-nav" aria-label="Home">
            <button
              type="button"
              className={`inbox-nav-row${
                homeView === 'unreads' ? ' is-active' : ''
              }${unreadsTotal > 0 ? ' has-unread' : ''}`}
              onClick={() => openUnreadsHome()}
            >
              <span className="inbox-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M3.5 4.5A1.5 1.5 0 0 1 5 3h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 15 17H5a1.5 1.5 0 0 1-1.5-1.5v-11ZM6 6.25v1.5h8v-1.5H6Zm0 3.5v1.5h8v-1.5H6Zm0 3.5V14.75h5V13.25H6Z"
                  />
                </svg>
              </span>
              <span className="inbox-nav-label">Unreads</span>
              {unreadsTotal > 0 ? (
                <span className="inbox-nav-badge">{unreadsTotal}</span>
              ) : null}
            </button>
            <button
              type="button"
              className={`inbox-nav-row${
                homeView === 'activity' ? ' is-active' : ''
              }${
                mentionsUnreadTotal > 0 || assignmentsUnreadTotal > 0
                  ? ' has-unread'
                  : ''
              }`}
              onClick={() => void openActivityHome('mentions')}
            >
              <span className="inbox-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M10 2a6 6 0 0 0-6 6v2.3l-1.4 2.1A1 1 0 0 0 3.4 14h13.2a1 1 0 0 0 .8-1.6L16 10.3V8a6 6 0 0 0-6-6Zm0 16a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 10 18Z"
                  />
                </svg>
              </span>
              <span className="inbox-nav-label">Activity</span>
              {mentionsUnreadTotal + assignmentsUnreadTotal > 0 ? (
                <span className="inbox-nav-badge">
                  {mentionsUnreadTotal + assignmentsUnreadTotal}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="inbox-nav-row"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('relay:open-daily-digest'));
              }}
            >
              <span className="inbox-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M4 3.5A1.5 1.5 0 0 1 5.5 2h9A1.5 1.5 0 0 1 16 3.5V5h1.25a.75.75 0 0 1 0 1.5H16v2h1.25a.75.75 0 0 1 0 1.5H16v2h1.25a.75.75 0 0 1 0 1.5H16v2.5A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5v-13ZM6.25 5.5v1.25h7.5V5.5h-7.5Zm0 3.5v1.25h7.5V9H6.25Zm0 3.5v1.25h5V12.5h-5Z"
                  />
                </svg>
              </span>
              <span className="inbox-nav-label">Daily digest</span>
            </button>
            <button
              type="button"
              className={`inbox-nav-row${
                homeView === 'drafts' ? ' is-active' : ''
              }${draftsCount + scheduledCount > 0 ? ' has-unread' : ''}`}
              onClick={() => void openDraftsHome()}
            >
              <span className="inbox-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M4 3.5A1.5 1.5 0 0 1 5.5 2h6.1L16 6.4V16.5A1.5 1.5 0 0 1 14.5 18h-9A1.5 1.5 0 0 1 4 16.5v-13ZM11 3v3.5h3.5L11 3Zm-5 7h8v1.5H6V10Zm0 3h5v1.5H6V13Z"
                  />
                </svg>
              </span>
              <span className="inbox-nav-label">Drafts & sent</span>
              {draftsCount + scheduledCount > 0 ? (
                <span className="inbox-nav-badge">
                  {draftsCount + scheduledCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className={`inbox-nav-row${
                homeView === 'threads' ? ' is-active' : ''
              }${threadsUnreadTotal > 0 ? ' has-unread' : ''}`}
              onClick={() => void openThreadsHome()}
            >
              <span className="inbox-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M4 4h9a2 2 0 0 1 2 2v5.2a2 2 0 0 1-2 2H9.4L6 16.5V13.2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm12 2.5V12a2 2 0 0 1-2 2h-.2v1.8L16.6 14H16a3.5 3.5 0 0 0 3.5-3.5V8A2 2 0 0 0 18 6.1c-.3-.1-.7-.1-1-.1-.3 0-.7 0-1 .1Z"
                  />
                </svg>
              </span>
              <span className="inbox-nav-label">Following</span>
              {threadsUnreadTotal > 0 ? (
                <span className="inbox-nav-badge">{threadsUnreadTotal}</span>
              ) : null}
            </button>
            <button
              type="button"
              className={`inbox-nav-row${
                homeView === 'later' ? ' is-active' : ''
              }${laterPendingCount > 0 ? ' has-unread' : ''}`}
              onClick={() => void openLaterInbox('later')}
            >
              <span className="inbox-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 4.25v3.4l2.6 1.55-.75 1.25L9.25 10.4V6.25h1.5Z"
                  />
                </svg>
              </span>
              <span className="inbox-nav-label">Later</span>
              {laterPendingCount > 0 ? (
                <span className="inbox-nav-badge">{laterPendingCount}</span>
              ) : savedTotalCount > 0 ? (
                <span className="inbox-nav-meta">{savedTotalCount}</span>
              ) : null}
            </button>
            <button
              type="button"
              className={`inbox-nav-row${
                homeView === 'wiki' ? ' is-active' : ''
              }`}
              onClick={() => openWikiInbox()}
            >
              <span className="inbox-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M4 3.5A1.5 1.5 0 0 1 5.5 2H9v16H5.5A1.5 1.5 0 0 1 4 16.5v-13ZM11 2h3.5A1.5 1.5 0 0 1 16 3.5v13a1.5 1.5 0 0 1-1.5 1.5H11V2Zm1.5 3.25h2v1.5h-2v-1.5Zm0 3h2v1.5h-2v-1.5Zm0 3h2v1.5h-2v-1.5Z"
                  />
                </svg>
              </span>
              <span className="inbox-nav-label">Wiki</span>
            </button>
            <button
              type="button"
              className={`inbox-nav-row${
                homeView === 'incidents' ? ' is-active' : ''
              }`}
              onClick={() => openIncidentsInbox()}
            >
              <span className="inbox-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M10 2.2 17.5 16H2.5L10 2.2Zm0 3.3L5.2 14.5h9.6L10 5.5ZM9.1 8.2h1.8v3.6H9.1V8.2Zm0 4.8h1.8V15H9.1v-2Z"
                  />
                </svg>
              </span>
              <span className="inbox-nav-label">Incidents</span>
            </button>
          </nav>

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
          {starredItems.length > 0 ? (
            <div className="inbox-custom-section inbox-starred-section">
              <div className="inbox-section-head">
                <button
                  type="button"
                  className="inbox-section-label inbox-section-toggle"
                  aria-expanded={!starredCollapsed}
                  onClick={() => setStarredCollapsed((v) => !v)}
                  title="Starred · drag chats to reorder"
                >
                  <span aria-hidden="true">{starredCollapsed ? '▸' : '▾'}</span>
                  Starred
                  {(() => {
                    const unread = sectionUnreadCount(starredItems);
                    return unread > 0 ? (
                      <span className="inbox-unread-pill">{unread}</span>
                    ) : null;
                  })()}
                </button>
              </div>
              {!starredCollapsed
                ? starredItems.map((item) =>
                    renderConversationRow(item, 'starred'),
                  )
                : null}
            </div>
          ) : null}
          {sidebarSections.map((section) => {
            const sectionItems = (section.conversationIds ?? [])
              .map((id) => conversationsById.get(id))
              .filter((row): row is Conversation => Boolean(row));
            const unread = sectionUnreadCount(sectionItems);
            const sectionScope = `section:${section.id}` as const;
            return (
              <div
                key={section.id}
                className={`inbox-custom-section${
                  draggingSectionId === section.id ? ' is-dragging' : ''
                }${
                  draggingConversationId ? ' is-drop-target' : ''
                }`}
                onDragOver={(event) => {
                  if (!dragConversationRef.current) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const payload = dragConversationRef.current;
                  let fromId = payload?.id ?? null;
                  let fromScope = payload?.scope ?? '';
                  if (!fromId) {
                    try {
                      const raw = event.dataTransfer.getData('text/plain');
                      const parsed = JSON.parse(raw) as {
                        id?: string;
                        scope?: string;
                      };
                      fromId = parsed.id ?? null;
                      fromScope = parsed.scope ?? '';
                    } catch {
                      fromId = null;
                    }
                  }
                  dragConversationRef.current = null;
                  setDraggingConversationId(null);
                  if (!fromId) return;
                  // Row-level drops handle same-section reorder.
                  if (fromScope === sectionScope) return;
                  void moveConversationToSection(fromId, section.id);
                }}
              >
                <div
                  className="inbox-section-head"
                  draggable={!sidebarBusy}
                  onDragStart={(event) => {
                    // Don't start section drag when beginning from a chat grip.
                    if (dragConversationRef.current) {
                      event.preventDefault();
                      return;
                    }
                    setDraggingSectionId(section.id);
                    event.dataTransfer.setData('text/plain', `section:${section.id}`);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDraggingSectionId(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const convPayload = dragConversationRef.current;
                    if (convPayload?.id) {
                      dragConversationRef.current = null;
                      setDraggingConversationId(null);
                      if (convPayload.scope !== sectionScope) {
                        void moveConversationToSection(
                          convPayload.id,
                          section.id,
                        );
                      }
                      return;
                    }
                    const raw = event.dataTransfer.getData('text/plain');
                    if (raw.startsWith('section:')) {
                      const sectionFrom = raw.slice('section:'.length);
                      if (sectionFrom) {
                        void reorderSidebarSections(sectionFrom, section.id);
                      }
                    }
                    setDraggingSectionId(null);
                  }}
                >
                  <button
                    type="button"
                    className="inbox-section-label inbox-section-toggle"
                    aria-expanded={!section.collapsed}
                    onClick={() => void toggleSectionCollapsed(section)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void renameSidebarSection(section);
                    }}
                    title="Click to collapse · drag header to reorder section · drop chats here · right-click to rename"
                  >
                    <span aria-hidden="true">{section.collapsed ? '▸' : '▾'}</span>
                    {section.name}
                    {unread > 0 ? (
                      <span className="inbox-unread-pill">{unread}</span>
                    ) : sectionItems.length > 0 ? (
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
                  ? sectionItems.map((item) =>
                      renderConversationRow(item, sectionScope),
                    )
                  : null}
                {!section.collapsed && sectionItems.length === 0 ? (
                  <p className="muted pad inbox-section-hint">
                    Drag a chat here, or use the section menu on a row.
                  </p>
                ) : null}
              </div>
            );
          })}
          {channels.map((item) => renderConversationRow(item, 'pool:channel'))}
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
          {directs.map((item) => renderConversationRow(item, 'pool:dm'))}
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
                const snippet = messageSnippet(hit.message, me, mentionLabel);
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
      {homeView ? (
        <section className="inbox-home-pane" aria-label="Home">
          <header className="inbox-home-head">
            <button
              type="button"
              className="ghost inbox-home-back"
              aria-label="Back to conversations"
              onClick={() => setHomeView(null)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"
                />
              </svg>
            </button>
            <h2>
              {homeView === 'unreads'
                ? 'Unreads'
                : homeView === 'activity'
                  ? 'Activity'
                  : homeView === 'drafts'
                    ? 'Drafts'
                    : homeView === 'threads'
                      ? 'Following'
                      : homeView === 'wiki'
                        ? 'Wiki'
                        : homeView === 'incidents'
                          ? 'Incidents'
                          : 'Later'}
            </h2>
          </header>
          <div className="inbox-home-body">
            {homeView === 'unreads' ? (
              <>
                <div className="unreads-toolbar">
                  <div className="unreads-toolbar-copy">
                    <p className="unreads-toolbar-count">
                      {unreadsTotal > 0
                        ? `${unreadsTotal} unread`
                        : 'All caught up'}
                    </p>
                    <p className="muted unreads-toolbar-sub">
                      {unreadsTotal > 0
                        ? `Across ${unreadConversations.length} conversation${
                            unreadConversations.length === 1 ? '' : 's'
                          }`
                        : 'New messages in channels and DMs will show up here.'}
                    </p>
                  </div>
                  {unreadConversations.length > 0 ? (
                    <button
                      type="button"
                      className="btn unreads-mark-all"
                      disabled={unreadsBusy}
                      onClick={() => void markAllUnreadsRead()}
                    >
                      {unreadsBusy ? 'Marking…' : 'Mark all as read'}
                    </button>
                  ) : null}
                </div>

                {unreadConversations.length === 0 ? (
                  <div className="unreads-empty">
                    <div className="unreads-empty-icon" aria-hidden="true">
                      ✓
                    </div>
                    <p className="unreads-empty-title">You’re all caught up</p>
                    <p className="muted">
                      When channels or DMs get new messages, they’ll land here —
                      same idea as Slack Unreads.
                    </p>
                  </div>
                ) : (
                  <div className="unreads-feed">
                    {unreadChannels.length > 0 ? (
                      <section className="unreads-section">
                        <h3 className="unreads-section-label">
                          Channels
                          <span className="unreads-section-count">
                            {unreadChannels.length}
                          </span>
                        </h3>
                        <ul className="unreads-list">
                          {unreadChannels.map((conversation) => {
                            const title = conversationTitle(
                              conversation,
                              me,
                              byUserId,
                            );
                            const snippet = conversation.lastMessage
                              ? messageSnippet(
                                  conversation.lastMessage,
                                  me,
                                  mentionLabel,
                                )
                              : 'New activity';
                            return (
                              <li key={conversation.id}>
                                <div
                                  className={`unreads-row${
                                    conversation.hasUnreadMention
                                      ? ' has-mention'
                                      : ''
                                  }`}
                                >
                                  <button
                                    type="button"
                                    className="unreads-row-main"
                                    onClick={() =>
                                      openUnreadConversation(conversation)
                                    }
                                  >
                                    <span
                                      className="unreads-channel-avatar"
                                      aria-hidden="true"
                                    >
                                      #
                                    </span>
                                    <span className="unreads-row-copy">
                                      <span className="unreads-row-title">
                                        {title.replace(/^#/, '')}
                                        {conversation.hasUnreadMention ? (
                                          <span className="unreads-mention-pill">
                                            @
                                          </span>
                                        ) : null}
                                      </span>
                                      <span className="unreads-row-snippet muted">
                                        {snippet}
                                      </span>
                                    </span>
                                  </button>
                                  <div className="unreads-row-side">
                                    {conversation.lastMessageAt ? (
                                      <RelativeTime
                                        value={conversation.lastMessageAt}
                                      />
                                    ) : null}
                                    <span className="inbox-unread-pill">
                                      {Math.max(
                                        1,
                                        conversation.unreadCount || 0,
                                      )}
                                    </span>
                                    <button
                                      type="button"
                                      className="ghost unreads-mark-one"
                                      title="Mark as read"
                                      aria-label={`Mark ${title} as read`}
                                      onClick={() =>
                                        void markConversationRead(
                                          conversation.id,
                                        )
                                      }
                                    >
                                      ✓
                                    </button>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ) : null}

                    {unreadDms.length > 0 ? (
                      <section className="unreads-section">
                        <h3 className="unreads-section-label">
                          Direct messages
                          <span className="unreads-section-count">
                            {unreadDms.length}
                          </span>
                        </h3>
                        <ul className="unreads-list">
                          {unreadDms.map((conversation) => {
                            const title = conversationTitle(
                              conversation,
                              me,
                              byUserId,
                            );
                            const peer = otherMember(conversation, me);
                            const snippet = conversation.lastMessage
                              ? messageSnippet(
                                  conversation.lastMessage,
                                  me,
                                  mentionLabel,
                                )
                              : 'New activity';
                            return (
                              <li key={conversation.id}>
                                <div
                                  className={`unreads-row${
                                    conversation.hasUnreadMention
                                      ? ' has-mention'
                                      : ''
                                  }`}
                                >
                                  <button
                                    type="button"
                                    className="unreads-row-main"
                                    onClick={() =>
                                      openUnreadConversation(conversation)
                                    }
                                  >
                                    <UserAvatar
                                      profile={
                                        peer
                                          ? byUserId.get(peer.userId)
                                          : null
                                      }
                                      name={title}
                                      size="sm"
                                      className="unreads-dm-avatar"
                                    />
                                    <span className="unreads-row-copy">
                                      <span className="unreads-row-title">
                                        {title}
                                        {conversation.hasUnreadMention ? (
                                          <span className="unreads-mention-pill">
                                            @
                                          </span>
                                        ) : null}
                                      </span>
                                      <span className="unreads-row-snippet muted">
                                        {snippet}
                                      </span>
                                    </span>
                                  </button>
                                  <div className="unreads-row-side">
                                    {conversation.lastMessageAt ? (
                                      <RelativeTime
                                        value={conversation.lastMessageAt}
                                      />
                                    ) : null}
                                    <span className="inbox-unread-pill">
                                      {Math.max(
                                        1,
                                        conversation.unreadCount || 0,
                                      )}
                                    </span>
                                    <button
                                      type="button"
                                      className="ghost unreads-mark-one"
                                      title="Mark as read"
                                      aria-label={`Mark ${title} as read`}
                                      onClick={() =>
                                        void markConversationRead(
                                          conversation.id,
                                        )
                                      }
                                    >
                                      ✓
                                    </button>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ) : null}
                  </div>
                )}
                {modalError ? <p className="error">{modalError}</p> : null}
              </>
            ) : null}
            {homeView === 'activity' ? (
              <>
<div className="later-tabs activity-tabs" role="tablist" aria-label="Activity views">
          <button
            type="button"
            role="tab"
            aria-selected={activityTab === 'mentions'}
            className={activityTab === 'mentions' ? 'on' : ''}
            onClick={() => {
              setActivityTab('mentions');
              void loadMentionsHome();
            }}
          >
            Mentions
            {mentionsUnreadTotal > 0 ? (
              <span className="inbox-unread-pill">{mentionsUnreadTotal}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activityTab === 'assigned'}
            className={activityTab === 'assigned' ? 'on' : ''}
            onClick={() => {
              setActivityTab('assigned');
              void loadAssignedHome();
            }}
          >
            Assigned
            {assignmentsUnreadTotal > 0 ? (
              <span className="inbox-unread-pill">{assignmentsUnreadTotal}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activityTab === 'threads'}
            className={activityTab === 'threads' ? 'on' : ''}
            onClick={() => {
              setActivityTab('threads');
              void loadThreadsHome();
            }}
          >
            Following
            {threadsUnreadTotal > 0 ? (
              <span className="inbox-unread-pill">{threadsUnreadTotal}</span>
            ) : null}
          </button>
        </div>

        {activityTab === 'mentions' ? (
          <>
            {mentionsBusy ? <p className="muted">Loading mentions…</p> : null}
            {!mentionsBusy && mentionItems.length === 0 ? (
              <p className="muted">
                When someone @mentions you, it shows up here — just like Slack
                Activity.
              </p>
            ) : null}
            <ul className="threads-home-list activity-mentions-list">
              {mentionItems.map((item) => {
                const channelLabel =
                  item.conversationType === 'group'
                    ? `#${(item.conversationName ?? 'channel').replace(/^#/, '')}`
                    : item.conversationName || 'Direct message';
                const sender = displayName(byUserId.get(item.message.senderId));
                return (
                  <li key={item.message.id}>
                    <InboxListRow
                      className={item.unread ? 'unread' : ''}
                      onClick={() => {
                        setHomeView(null);
                        const focus = encodeURIComponent(item.message.id);
                        const thread = item.message.threadRootId
                          ? `&thread=${encodeURIComponent(item.message.threadRootId)}`
                          : '';
                        navigate(
                          `/chat/${item.conversationId}?focus=${focus}${thread}`,
                        );
                      }}
                    >
                      <div className="threads-home-meta">
                        <UserAvatar
                          profile={byUserId.get(item.message.senderId)}
                          name={sender}
                          size="sm"
                        />
                        <strong>{sender}</strong>
                        <span className="muted">mentioned you in {channelLabel}</span>
                        <RelativeTime value={item.message.createdAt} />
                      </div>
                      <span className="threads-home-snippet">
                        {messageSnippet(item.message, me, mentionLabel)}
                      </span>
                    </InboxListRow>
                  </li>
                );
              })}
            </ul>
          </>
        ) : activityTab === 'assigned' ? (
          <>
            <div className="activity-assigned-toolbar">
              {assignmentsUnreadTotal > 0 ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void markAllAssignmentsRead()}
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            {assignmentsBusy ? <p className="muted">Loading assignments…</p> : null}
            {!assignmentsBusy && assignmentItems.length === 0 ? (
              <p className="muted">
                Assignments and due-date reminders for your list tasks show up
                here.
              </p>
            ) : null}
            <ul className="threads-home-list activity-mentions-list">
              {assignmentItems.map((item) => {
                const actor = displayName(byUserId.get(item.actorId));
                const listName =
                  typeof item.meta?.listName === 'string'
                    ? item.meta.listName
                    : 'List';
                return (
                  <li key={item.id}>
                    <InboxListRow
                      className={item.unread ? 'unread' : ''}
                      onClick={() => {
                        void markAssignmentRead(item);
                        setHomeView(null);
                        if (item.conversationId) {
                          navigate(
                            `/chat/${item.conversationId}?tab=lists`,
                          );
                        }
                      }}
                    >
                      <div className="threads-home-meta">
                        <UserAvatar
                          profile={byUserId.get(item.actorId)}
                          name={actor}
                          size="sm"
                        />
                        <strong>
                          {item.type === 'list_due' ? 'Due' : actor}
                        </strong>
                        <span className="muted">
                          {item.type === 'list_due'
                            ? `task due in ${listName}`
                            : `assigned you a task in ${listName}`}
                        </span>
                        <RelativeTime value={item.createdAt} />
                      </div>
                      <span className="threads-home-snippet">
                        {resolveSlackMentions(item.body, mentionLabel)}
                      </span>
                    </InboxListRow>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            {threadsBusy ? <p className="muted">Loading threads…</p> : null}
            {!threadsBusy && threadItems.length === 0 ? (
              <p className="muted">
                Threads you open or reply in show up here. Unfollow any time to
                stop getting updates.
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
                  <li key={item.root.id} className="following-thread-row">
                    <InboxListRow
                      className={unread ? 'unread' : ''}
                      onClick={() => {
                        setHomeView(null);
                        navigate(
                          `/chat/${item.conversationId}?thread=${item.root.id}`,
                        );
                      }}
                    >
                      <div className="threads-home-meta">
                        <strong>{channelLabel}</strong>
                        {unread ? (
                          <span className="inbox-unread-pill">
                            {item.unreadCount}
                          </span>
                        ) : null}
                        <RelativeTime value={item.lastReplyAt} />
                      </div>
                      <span className="threads-home-snippet">
                        {displayName(byUserId.get(item.root.senderId))}:{' '}
                        {messageSnippet(item.root, me, mentionLabel)}
                      </span>
                      <span className="threads-home-snippet muted">
                        Latest · {displayName(byUserId.get(latest.senderId))}:{' '}
                        {messageSnippet(latest, me, mentionLabel)}
                      </span>
                    </InboxListRow>
                    <button
                      type="button"
                      className="ghost following-unfollow-btn"
                      title="Unfollow thread"
                      onClick={() =>
                        void unfollowThreadHome(
                          item.conversationId,
                          item.root.id,
                        )
                      }
                    >
                      Unfollow
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {modalError ? <p className="error">{modalError}</p> : null}
              </>
            ) : null}
            {homeView === 'drafts' ? (
              <>
                <div className="later-panel drafts-scheduled-panel">
                  <div className="later-tabs" role="tablist" aria-label="Drafts views">
                    <button
                      type="button"
                      role="tab"
                      className={draftsTab === 'drafts' ? 'on' : ''}
                      aria-selected={draftsTab === 'drafts'}
                      onClick={() => setDraftsTab('drafts')}
                    >
                      Drafts
                      {draftsCount > 0 ? (
                        <span className="later-tab-count">{draftsCount}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={draftsTab === 'scheduled' ? 'on' : ''}
                      aria-selected={draftsTab === 'scheduled'}
                      onClick={() => {
                        setDraftsTab('scheduled');
                        void openDraftsHome('scheduled');
                      }}
                    >
                      Scheduled
                      {scheduledCount > 0 ? (
                        <span className="later-tab-count">{scheduledCount}</span>
                      ) : null}
                    </button>
                  </div>

                  {draftsTab === 'drafts' ? (
                    <>
                      {draftsBusy ? <p className="muted">Loading drafts…</p> : null}
                      {!draftsBusy && draftItems.length === 0 ? (
                        <div className="later-empty">
                          <p className="muted">No drafts yet.</p>
                          <p className="muted later-empty-hint">
                            Start typing in a channel and your unsent message
                            shows up here — same idea as Slack Drafts.
                          </p>
                        </div>
                      ) : null}
                      <ul className="threads-home-list drafts-home-list">
                        {draftItems.map((item) => {
                          const conversation = items.find(
                            (row) => row.id === item.conversationId,
                          );
                          const channelLabel = conversation
                            ? conversationTitle(conversation, me, byUserId)
                            : item.conversationType === 'group'
                              ? `#${(item.conversationName ?? 'channel').replace(/^#/, '')}`
                              : item.conversationName || 'Direct message';
                          return (
                            <li key={item.conversationId}>
                              <div className="drafts-home-row">
                                <InboxListRow
                                  className="draft-open"
                                  onClick={() => {
                                    setHomeView(null);
                                    navigate(`/chat/${item.conversationId}`);
                                  }}
                                >
                                  <div className="threads-home-meta">
                                    <strong>{channelLabel}</strong>
                                    <RelativeTime value={item.updatedAt} />
                                  </div>
                                  <span className="threads-home-snippet">
                                    {singleLinePreview(item.body)}
                                  </span>
                                </InboxListRow>
                                <button
                                  type="button"
                                  className="ghost drafts-discard"
                                  onClick={() =>
                                    void discardDraft(item.conversationId)
                                  }
                                >
                                  Discard
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <>
                      {scheduledBusy ? (
                        <p className="muted">Loading scheduled messages…</p>
                      ) : null}
                      {!scheduledBusy && scheduledInboxItems.length === 0 ? (
                        <div className="later-empty">
                          <p className="muted">Nothing scheduled.</p>
                          <p className="muted later-empty-hint">
                            Use the schedule control next to Send in any chat to
                            queue a message for later.
                          </p>
                        </div>
                      ) : null}
                      <ul className="threads-home-list drafts-home-list">
                        {scheduledInboxItems.map((item) => {
                          const channelLabel =
                            item.conversationType === 'group'
                              ? `#${(item.conversationName ?? 'channel').replace(/^#/, '')}`
                              : item.conversationName?.trim() || 'Direct message';
                          const snippet = resolveSlackMentions(
                            item.body?.trim() ||
                              item.attachment?.name ||
                              'Scheduled message',
                            mentionLabel,
                          );
                          return (
                            <li key={item.id}>
                              <div className="drafts-home-row later-inbox-row">
                                <InboxListRow
                                  onClick={() => {
                                    setHomeView(null);
                                    navigate(`/chat/${item.conversationId}`);
                                  }}
                                >
                                  <div className="threads-home-meta">
                                    <strong>{channelLabel}</strong>
                                    <span className="muted threads-home-meta-side">
                                      Sends {formatScheduleWhen(item.scheduledFor)}
                                    </span>
                                  </div>
                                  <span className="threads-home-snippet">
                                    {singleLinePreview(snippet)}
                                  </span>
                                </InboxListRow>
                                <div className="later-row-actions">
                                  <button
                                    type="button"
                                    className="ghost later-cancel-btn"
                                    onClick={() =>
                                      void cancelScheduledInboxItem(item)
                                    }
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                  {modalError ? <p className="error">{modalError}</p> : null}
                </div>
              </>
            ) : null}
            {homeView === 'threads' ? (
              <>
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
              <li key={item.root.id} className="following-thread-row">
                <InboxListRow
                  className={unread ? 'unread' : ''}
                  onClick={() => {
                    setHomeView(null);
                    navigate(
                      `/chat/${item.conversationId}?thread=${item.root.id}`,
                    );
                  }}
                >
                  <div className="threads-home-meta">
                    <strong className="threads-home-channel">{channelLabel}</strong>
                    <span className="threads-home-meta-side">
                      {unread ? (
                        <span className="inbox-unread-pill">
                          {item.unreadCount}
                        </span>
                      ) : null}
                      <span className="muted">
                        {item.replyCount}{' '}
                        {item.replyCount === 1 ? 'reply' : 'replies'}
                      </span>
                    </span>
                  </div>
                  <span className="threads-home-snippet">
                    {displayName(byUserId.get(item.root.senderId))}:{' '}
                    {messageSnippet(item.root, me, mentionLabel)}
                  </span>
                  <span className="threads-home-snippet muted">
                    Latest · {displayName(byUserId.get(latest.senderId))}:{' '}
                    {messageSnippet(latest, me, mentionLabel)}
                  </span>
                </InboxListRow>
                <button
                  type="button"
                  className="ghost following-unfollow-btn"
                  title="Unfollow thread"
                  onClick={() =>
                    void unfollowThreadHome(item.conversationId, item.root.id)
                  }
                >
                  Unfollow
                </button>
              </li>
            );
          })}
        </ul>
        {modalError ? <p className="error">{modalError}</p> : null}
              </>
            ) : null}
            {homeView === 'later' ? (
              <>
<div className="later-panel">
          <header className="later-panel-head">
            <div>
              <h3>Later</h3>
              <p className="muted">
                Reminders and saved messages — pick them up when you are ready.
              </p>
            </div>
          </header>

          <div className="later-tabs" role="tablist" aria-label="Later views">
            <button
              type="button"
              role="tab"
              className={laterTab === 'later' ? 'on' : ''}
              aria-selected={laterTab === 'later'}
              onClick={() => {
                setLaterTab('later');
                setLaterQuery('');
              }}
            >
              Reminders
              {laterPendingCount > 0 ? (
                <span className="later-tab-count">{laterPendingCount}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              className={laterTab === 'saved' ? 'on' : ''}
              aria-selected={laterTab === 'saved'}
              onClick={() => {
                setLaterTab('saved');
                setLaterQuery('');
                void refreshSaved();
              }}
            >
              Saved
              {savedTotalCount > 0 ? (
                <span className="later-tab-count">{savedTotalCount}</span>
              ) : null}
            </button>
          </div>

          <div className="later-toolbar">
            <input
              value={laterQuery}
              onChange={(event) => setLaterQuery(event.target.value)}
              placeholder={
                laterTab === 'later'
                  ? 'Search reminders…'
                  : 'Search saved messages…'
              }
              aria-label={
                laterTab === 'later'
                  ? 'Search reminders'
                  : 'Search saved messages'
              }
            />
            {laterQuery.trim() ? (
              <button
                type="button"
                className="ghost"
                onClick={() => setLaterQuery('')}
              >
                Clear
              </button>
            ) : null}
          </div>

          {laterTab === 'later' ? (
            <>
              {laterBusy ? <p className="muted">Loading reminders…</p> : null}
              {!laterBusy &&
              laterSections.overdue.length === 0 &&
              laterSections.upcoming.length === 0 &&
              laterSections.completed.length === 0 ? (
                <div className="later-empty">
                  <p className="muted">
                    {laterQuery.trim()
                      ? `No reminders match “${laterQuery.trim()}”.`
                      : 'Nothing waiting for you yet.'}
                  </p>
                  {!laterQuery.trim() ? (
                    <p className="muted later-empty-hint">
                      Open any message menu → <strong>Remind me</strong>. Due
                      items land here until you complete, snooze, or cancel them.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {(
                [
                  {
                    key: 'overdue',
                    label: 'Overdue',
                    items: laterSections.overdue,
                  },
                  {
                    key: 'upcoming',
                    label: 'Upcoming',
                    items: laterSections.upcoming,
                  },
                  {
                    key: 'completed',
                    label: 'Completed',
                    items: laterSections.completed,
                  },
                ] as const
              ).map((section) =>
                section.items.length === 0 ? null : (
                  <div key={section.key} className="later-section">
                    <div className="later-section-head">
                      <h4>
                        {section.label}
                        <span className="muted"> · {section.items.length}</span>
                      </h4>
                      {section.key === 'completed' ? (
                        <button
                          type="button"
                          className="ghost later-clear-btn"
                          onClick={() => void clearCompletedLater()}
                        >
                          Clear all
                        </button>
                      ) : null}
                    </div>
                    <ul className="threads-home-list later-inbox-list">
                      {section.items.map((item) => {
                        const channelLabel =
                          item.conversationType === 'group'
                            ? `#${(item.conversationName ?? 'channel').replace(/^#/, '')}`
                            : item.conversationName?.trim() || 'Direct message';
                        const dueLabel =
                          item.status === 'completed'
                            ? item.completedAt
                              ? `Completed · ${formatScheduleWhen(item.completedAt)}`
                              : 'Completed'
                            : item.status === 'sent'
                              ? `Notified · ${formatScheduleWhen(item.remindAt)}`
                              : formatScheduleWhen(item.remindAt);
                        const snippet = resolveSlackMentions(
                          item.bodySnippet?.trim() || 'Message reminder',
                          mentionLabel,
                        );
                        return (
                          <li key={item.id}>
                            <div className="later-inbox-row">
                              <InboxListRow
                                onClick={() => {
                                  setHomeView(null);
                                  navigate(
                                    `/chat/${item.conversationId}?focus=${item.messageId}`,
                                  );
                                }}
                              >
                                <div className="threads-home-meta">
                                  <strong className="threads-home-channel">{channelLabel}</strong>
                                  <span
                                    className={`muted threads-home-meta-side${
                                      section.key === 'overdue'
                                        ? ' later-overdue'
                                        : ''
                                    }`}
                                  >
                                    {dueLabel}
                                  </span>
                                </div>
                                <span className="threads-home-snippet">
                                  {singleLinePreview(snippet)}
                                </span>
                              </InboxListRow>
                              <div className="later-row-actions">
                                {item.status === 'pending' ||
                                item.status === 'sent' ? (
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() =>
                                      void completeLaterReminder(item.id)
                                    }
                                  >
                                    Done
                                  </button>
                                ) : null}
                                {item.status === 'pending' ? (
                                  <>
                                    <button
                                      type="button"
                                      className="ghost"
                                      disabled={snoozingId === item.id}
                                      title="Snooze 1 hour"
                                      onClick={() =>
                                        void snoozeLaterReminder(
                                          item,
                                          remindAtInOneHour(),
                                        )
                                      }
                                    >
                                      +1h
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost"
                                      disabled={snoozingId === item.id}
                                      title="Snooze until tomorrow 9:00"
                                      onClick={() =>
                                        void snoozeLaterReminder(
                                          item,
                                          remindAtTomorrowMorning(),
                                        )
                                      }
                                    >
                                      +1d
                                    </button>
                                    <button
                                      type="button"
                                      className="ghost later-cancel-btn"
                                      onClick={() =>
                                        void cancelLaterReminder(item.id)
                                      }
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ),
              )}
            </>
          ) : (
            <>
              <div className="saved-folder-bar">
                <div className="saved-folder-chips" role="tablist" aria-label="Saved folders">
                  <button
                    type="button"
                    className={savedFolderId === 'all' ? 'on' : ''}
                    onClick={() => {
                      setSavedFolderId('all');
                    }}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={savedFolderId === 'none' ? 'on' : ''}
                    onClick={() => setSavedFolderId('none')}
                  >
                    Unfiled
                  </button>
                  {bookmarkCollections.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className={savedFolderId === folder.id ? 'on' : ''}
                      onClick={() => setSavedFolderId(folder.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void renameSavedFolder(folder.id, folder.name);
                      }}
                      title={`${folder.bookmarkCount} saved · right-click to rename`}
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
                <form
                  className="saved-folder-create"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createSavedFolder();
                  }}
                >
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder="New folder"
                    maxLength={120}
                  />
                  <button type="submit" className="ghost" disabled={!newFolderName.trim()}>
                    Add
                  </button>
                </form>
                {savedFolderId !== 'all' &&
                savedFolderId !== 'none' &&
                bookmarkCollections.some((f) => f.id === savedFolderId) ? (
                  <>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        const folder = bookmarkCollections.find(
                          (item) => item.id === savedFolderId,
                        );
                        if (folder) {
                          void renameSavedFolder(folder.id, folder.name);
                        }
                      }}
                    >
                      Rename folder
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void deleteSavedFolder(savedFolderId)}
                    >
                      Delete folder
                    </button>
                  </>
                ) : null}
              </div>
              {savedBusy ? <p className="muted">Loading saved messages…</p> : null}
              {!savedBusy && filteredSavedItems.length === 0 ? (
                <div className="later-empty">
                  <p className="muted">
                    {laterQuery.trim()
                      ? `No saved messages match “${laterQuery.trim()}”.`
                      : savedItems.length === 0
                        ? 'No saved messages yet.'
                        : 'Nothing in this folder.'}
                  </p>
                  {!laterQuery.trim() && savedItems.length === 0 ? (
                    <p className="muted later-empty-hint">
                      Save any message from the ⋮ menu, then organize into
                      folders here.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <ul className="saved-messages-list later-saved-list">
                {filteredSavedItems.map((item) => {
                  const title =
                    item.conversationName?.trim() ||
                    (item.conversationType === 'group'
                      ? 'Channel'
                      : 'Direct message');
                  const rawSnippet =
                    item.message?.body?.trim() ||
                    item.message?.attachment?.name ||
                    'Saved message';
                  const snippet = resolveSlackMentions(rawSnippet, mentionLabel);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="saved-message-row"
                        onClick={() => {
                          setHomeView(null);
                          navigate(
                            `/chat/${item.conversationId}?focus=${encodeURIComponent(item.messageId)}`,
                          );
                        }}
                      >
                        <strong>{title}</strong>
                        <span>{snippet}</span>
                        <small>{formatScheduleWhen(item.createdAt)}</small>
                      </button>
                      <label className="saved-folder-move">
                        <span className="sr-only">Move to folder</span>
                        <select
                          value={item.collectionId ?? ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            void moveSavedToFolder(
                              item.messageId,
                              value ? value : null,
                            );
                          }}
                        >
                          <option value="">Unfiled</option>
                          {bookmarkCollections.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void unsaveBookmark(item.messageId)}
                      >
                        Unsave
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {modalError ? <p className="error">{modalError}</p> : null}
        </div>
              </>
            ) : null}
            {homeView === 'wiki' ? <WikiView /> : null}
            {homeView === 'incidents' ? (
              <IncidentsView
                onOpenChannel={(conversationId) => {
                  setHomeView(null);
                  navigate(`/chat/${conversationId}`);
                }}
              />
            ) : null}
          </div>
        </section>
      ) : (
        <Outlet context={outletContext} />
      )}

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
            Announce-only — admins post, members read
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

      

      

      

      

      
    </div>
  );
}
