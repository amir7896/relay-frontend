import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { getAccessToken } from '../../auth/session';
import { useAuth } from '../../auth/AuthContext';
import { useChatSocket } from '../../chat/ChatSocketContext';
import { useVoiceCall } from '../../calls/VoiceCallContext';
import { Modal } from '../../components/Modal';
import { MessageTicks } from '../../components/MessageTicks';
import { PeoplePicker } from '../../components/PeoplePicker';
import {
  resolveMediaUrl,
  VoiceNotePlayer,
} from '../../components/VoiceNotePlayer';
import {
  clock,
  conversationTitle,
  displayName,
  formatLastSeen,
  initials,
  otherMember,
} from '../../lib/format';
import {
  callHistoryLabel,
  parseCallHistoryBody,
} from '../../calls/types';
import {
  extractMentionIds,
  firstUrl,
  isPlaceholderBody,
  parseMentionQuery,
  renderMessageBody,
} from '../../lib/chatComposer';
import {
  clearMessageDraft,
  getMessageDraft,
  setMessageDraft,
} from '../../lib/messageDrafts';
import { downloadMedia, openMedia as openAttachmentMedia } from '../../lib/downloadMedia';
import { useDirectory } from '../../people/useDirectory';
import type {
  ChatMessage,
  Conversation,
  LinkPreview,
  Paginated,
  ScheduledMessage,
  SeenResult,
} from '../../api/types';
import type { MessengerOutletContext } from './MessengerPage';

const DELETE_FOR_EVERYONE_MS = Number.POSITIVE_INFINITY;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

type VoicePhase = 'idle' | 'recording' | 'preview';

function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleLocalValue() {
  return toDatetimeLocalValue(new Date(Date.now() + 5 * 60 * 1000));
}

function formatScheduleWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
type MediaKindTab = 'all' | 'image' | 'file' | 'audio';

function mediaKindOf(message: ChatMessage): 'image' | 'file' | 'audio' {
  const mime = message.attachment?.mime ?? '';
  if (
    message.type === 'audio' ||
    mime.startsWith('audio/') ||
    (message.type === 'audio' && mime.startsWith('video/'))
  ) {
    return 'audio';
  }
  if (message.type === 'image' || mime.startsWith('image/')) {
    return 'image';
  }
  return 'file';
}

function mediaDownloadName(message: ChatMessage): string {
  const attachment = message.attachment;
  if (attachment?.name?.trim()) {
    return attachment.name.trim();
  }
  const kind = mediaKindOf(message);
  if (kind === 'image') {
    return 'photo.jpg';
  }
  if (kind === 'audio') {
    return 'voice-note.webm';
  }
  return 'file';
}

function formatRecordingClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    reactions: message.reactions ?? [],
    attachment: message.attachment ?? null,
    mentions: message.mentions ?? [],
    linkPreview: message.linkPreview ?? null,
    editedAt: message.editedAt ?? null,
    pinned: Boolean(message.pinned),
    pinnedAt: message.pinnedAt ?? null,
    pinnedByUserId: message.pinnedByUserId ?? null,
    forwarded: Boolean(message.forwarded),
    expiresAt: message.expiresAt ?? null,
  };
}

const DISAPPEARING_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 3600, label: '1 hour' },
  { value: 86_400, label: '24 hours' },
  { value: 604_800, label: '7 days' },
  { value: 7_776_000, label: '90 days' },
];

function disappearingLabel(seconds: number | undefined) {
  const match = DISAPPEARING_OPTIONS.find((item) => item.value === (seconds ?? 0));
  return match?.label ?? 'Off';
}

function upsertMessage(current: ChatMessage[], payload: ChatMessage): ChatMessage[] {
  const next = normalizeMessage(payload);
  const index = current.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [...current, next];
  }
  const copy = [...current];
  copy[index] = next;
  return copy;
}

function isPendingMessage(message: ChatMessage): boolean {
  return Boolean(message.sendStatus);
}

function replySnippet(message: {
  body?: string | null;
  type?: string | null;
  attachment?: { mime?: string; name?: string } | null;
  deletedForEveryone?: boolean;
}): string {
  if (message.deletedForEveryone) {
    return 'This message was deleted';
  }
  const body = message.body?.trim();
  if (body && !isPlaceholderBody(body)) {
    return body.length > 120 ? `${body.slice(0, 117)}…` : body;
  }
  const mime = message.attachment?.mime ?? '';
  if (mime.startsWith('image/') || message.type === 'image') {
    return 'Photo';
  }
  if (mime.startsWith('audio/') || message.type === 'audio') {
    return 'Voice message';
  }
  if (message.type === 'file' || message.attachment) {
    return message.attachment?.name || 'File';
  }
  if (message.type === 'call') {
    return 'Call';
  }
  return body || 'Message';
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKindFromMime(mime: string, name = ''): 'image' | 'audio' | 'file' {
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('audio/') || mime === 'video/webm') {
    return 'audio';
  }
  const lower = name.toLowerCase();
  if (/\.(jpe?g|png|gif|webp)$/.test(lower)) {
    return 'image';
  }
  if (/\.(webm|ogg|mp3|m4a|wav)$/.test(lower)) {
    return 'audio';
  }
  return 'file';
}

function fileExtLabel(name: string, mime: string): string {
  const fromName = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
  if (fromName && fromName.length <= 5) {
    return fromName;
  }
  if (mime === 'application/pdf') {
    return 'PDF';
  }
  if (mime.includes('word') || mime.includes('document')) {
    return 'DOC';
  }
  if (mime.includes('sheet') || mime.includes('excel')) {
    return 'XLS';
  }
  if (mime.includes('presentation') || mime.includes('powerpoint')) {
    return 'PPT';
  }
  if (mime.includes('zip') || mime.includes('rar')) {
    return 'ZIP';
  }
  return 'FILE';
}

function revokeAttachmentBlob(message: ChatMessage) {
  const url = message.attachment?.url;
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

function replacePendingWithServer(
  current: ChatMessage[],
  pendingId: string,
  serverMessage: ChatMessage,
): ChatMessage[] {
  const pending = current.find((item) => item.id === pendingId);
  if (pending) {
    revokeAttachmentBlob(pending);
  }
  const withoutPending = current.filter((item) => item.id !== pendingId);
  return upsertMessage(withoutPending, serverMessage);
}

function consumeMatchingPending(
  current: ChatMessage[],
  serverMessage: ChatMessage,
  myUserId: string | undefined,
): ChatMessage[] {
  if (!myUserId || serverMessage.senderId !== myUserId || isPendingMessage(serverMessage)) {
    return upsertMessage(current, serverMessage);
  }
  const pendingIndex = current.findIndex(
    (item) =>
      item.sendStatus &&
      item.sendStatus !== 'failed' &&
      item.senderId === myUserId &&
      item.type === serverMessage.type,
  );
  if (pendingIndex === -1) {
    return upsertMessage(current, serverMessage);
  }
  return replacePendingWithServer(current, current[pendingIndex].id, serverMessage);
}

async function uploadFileWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ url: string; mime: string; name: string; size: number }> {
  const token = getAccessToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/chat/uploads');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText) as {
          data?: { url: string; mime: string; name: string; size: number };
          message?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && payload.data) {
          onProgress(100);
          resolve(payload.data);
          return;
        }
        reject(new Error(payload.message ?? 'Upload failed'));
      } catch {
        reject(new Error('Upload failed'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export function ThreadView() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusMessageId = searchParams.get('focus');
  const { session } = useAuth();
  const me = session?.user.id;
  const navigate = useNavigate();
  const { clearUnread, refreshInbox, conversations } =
    useOutletContext<MessengerOutletContext>();
  const { people, byUserId, ensureProfiles } = useDirectory();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState('');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState(false);
  const [composer, setComposer] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [menuMessageId, setMenuMessageId] = useState<string | null>(null);
  const [reactPickerId, setReactPickerId] = useState<string | null>(null);
  const [forwardMessage, setForwardMessage] = useState<ChatMessage | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [pinnedBannerOpen, setPinnedBannerOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaKind, setMediaKind] = useState<MediaKindTab>('all');
  const [mediaItems, setMediaItems] = useState<ChatMessage[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaPage, setMediaPage] = useState(1);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [mediaDownloadingId, setMediaDownloadingId] = useState<string | null>(null);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleLocalValue);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const [pendingLinkPreview, setPendingLinkPreview] = useState<LinkPreview | null>(null);
  const [summary, setSummary] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [recordingMs, setRecordingMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedAtRef = useRef(0);
  const discardOnStopRef = useRef(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const scheduledMessagesRef = useRef(scheduledMessages);
  scheduledMessagesRef.current = scheduledMessages;
  const hasOlderRef = useRef(hasOlder);
  hasOlderRef.current = hasOlder;
  const messagePageRef = useRef(messagePage);
  messagePageRef.current = messagePage;
  const focusBusyRef = useRef(false);
  const { joinConversation, leaveConversation, subscribe, emit } = useChatSocket();
  const {
    phase: callPhase,
    startCall,
    joinCall,
    refreshLobby,
    lobbiesByConversation,
  } = useVoiceCall();
  const ongoingLobby = lobbiesByConversation[id];
  const canJoinOngoing =
    conversation?.type === 'group' &&
    callPhase === 'idle' &&
    Boolean(ongoingLobby?.active) &&
    Boolean(ongoingLobby?.joinedIds.length) &&
    !ongoingLobby?.joinedIds.includes(me || '');

  const ongoingCallParticipants = useMemo(() => {
    const joined = ongoingLobby?.joinedIds ?? [];
    return joined.map((userId) => {
      const person = byUserId.get(userId);
      const name = displayName(person);
      return {
        userId,
        name,
        initials: initials(name),
        avatar: person?.avatar ? resolveMediaUrl(person.avatar) : null,
      };
    });
  }, [byUserId, ongoingLobby?.joinedIds]);

  const title = useMemo(
    () => (conversation ? conversationTitle(conversation, me, byUserId) : 'Conversation'),
    [conversation, me, byUserId],
  );
  const peer = conversation ? otherMember(conversation, me) : undefined;
  const peerOnline = peer?.status === 'online';
  const groupOnlineCount =
    conversation?.type === 'group'
      ? conversation.members.filter(
          (member) => member.status === 'online' && member.userId !== me,
        ).length
      : 0;
  const statusLabel = useMemo(() => {
    if (!conversation) {
      return '';
    }
    if (typing) {
      return typing;
    }
    if (conversation.type === 'group') {
      const onlineBit =
        groupOnlineCount > 0
          ? `${groupOnlineCount} online`
          : 'no one online';
      return `${onlineBit} · ${conversation.members.length} members`;
    }
    if (!peer) {
      return 'Offline';
    }
    return formatLastSeen(peer.lastSeenAt, peer.status);
  }, [conversation, typing, groupOnlineCount, peer]);
  const myRole = conversation?.members.find((member) => member.userId === me)?.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const isCreator = Boolean(me && conversation?.createdBy === me);
  const memberIds = conversation?.members.map((member) => member.userId) ?? [];
  const forwardTargets = useMemo(
    () => conversations.filter((item) => item.id !== id),
    [conversations, id],
  );

  const mentionCandidates = useMemo(() => {
    if (!conversation || conversation.type !== 'group') {
      return [];
    }
    return conversation.members
      .filter((member) => member.userId !== me)
      .map((member) => ({
        userId: member.userId,
        label: displayName(byUserId.get(member.userId)),
      }));
  }, [conversation, me, byUserId]);

  const mentionQuery = parseMentionQuery(composer);
  const filteredMentions = mentionQuery
    ? mentionCandidates.filter((member) =>
        member.label.toLowerCase().includes(mentionQuery.query),
      )
    : [];

  async function loadHistory(page = 1, prepend = false) {
    const history = await api<Paginated<ChatMessage>>(
      `/chat/conversations/${id}/messages?page=${page}&limit=80`,
    );
    const batch = [...history.data.items].reverse().map(normalizeMessage);
    setMessages((current) => (prepend ? [...batch, ...current] : batch));
    setHasOlder(history.data.meta.hasNextPage);
    setMessagePage(page);
    return history;
  }

  async function loadPinned() {
    try {
      const response = await api<ChatMessage[]>(
        `/chat/conversations/${id}/pinned-messages`,
      );
      setPinnedMessages(response.data.map(normalizeMessage));
    } catch {
      setPinnedMessages([]);
    }
  }

  async function loadScheduled() {
    try {
      const response = await api<ScheduledMessage[]>(
        `/chat/conversations/${id}/scheduled-messages`,
      );
      setScheduledMessages(response.data.filter((item) => item.status === 'pending'));
    } catch {
      setScheduledMessages([]);
    }
  }

  useEffect(() => {
    if (scheduledMessages.length === 0 || !id) {
      return;
    }
    void loadScheduled();
    const timer = window.setInterval(() => {
      void loadScheduled();
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [id, scheduledMessages.length]);

  async function load() {
    setLoading(true);
    setConversation(null);
    setMessages([]);
    setPinnedMessages([]);
    setPinnedBannerOpen(false);
    setScheduledMessages([]);
    setScheduleOpen(false);
    setSummary('');
    const conv = await api<Conversation>(`/chat/conversations/${id}`);
    await loadHistory(1, false);
    void loadPinned();
    void loadScheduled();
    setConversation({
      ...conv.data,
      muted: Boolean(conv.data.muted),
      pinned: Boolean(conv.data.pinned),
    });
    setLoading(false);
    clearUnread(id);
    void ensureProfiles(conv.data.members.map((member) => member.userId));
    if (conv.data.type === 'group') {
      void refreshLobby(id);
    }
    try {
      await api(`/chat/conversations/${id}/seen`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      clearUnread(id);
    } catch {
      clearUnread(id);
    }
  }

  async function loadOlder() {
    if (loadingOlder || !hasOlder) {
      return;
    }
    setLoadingOlder(true);
    const scrollerEl = scroller.current;
    const previousHeight = scrollerEl?.scrollHeight ?? 0;
    await loadHistory(messagePage + 1, true);
    setLoadingOlder(false);
    requestAnimationFrame(() => {
      if (scrollerEl) {
        scrollerEl.scrollTop = scrollerEl.scrollHeight - previousHeight;
      }
    });
  }

  useEffect(() => {
    setError('');
    setActionError('');
    setDetails(false);
    setComposer(getMessageDraft(id));
    setTyping('');
    setReplyTo(null);
    setEditingMessage(null);
    setMenuMessageId(null);
    setReactPickerId(null);
    setForwardMessage(null);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setPinnedMessages([]);
    setPinnedBannerOpen(false);
    setMediaOpen(false);
    setMediaKind('all');
    setMediaItems([]);
    setMediaPage(1);
    setMediaHasMore(false);
    setMediaDownloadingId(null);
    setHighlightId(null);
    setMessages((current) => {
      current.forEach(revokeAttachmentBlob);
      return [];
    });
    resetVoiceSession();
    void load().catch((err: unknown) => {
      setLoading(false);
      setConversation(null);
      setMessages([]);
      setError(err instanceof Error ? err.message : 'Could not open this chat');
    });

    joinConversation(id);

    const unsubs = [
      subscribe('chat:message', (payload) => {
        const message = payload as ChatMessage;
        if (message.conversationId !== id) {
          return;
        }
        const normalized = normalizeMessage(message);
        setMessages((current) => consumeMatchingPending(current, normalized, me));
        setPinnedMessages((current) => {
          const without = current.filter((item) => item.id !== normalized.id);
          if (normalized.pinned && !normalized.deletedForEveryone) {
            return [normalized, ...without].sort((a, b) =>
              (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''),
            );
          }
          return without;
        });
        // Scheduled delivery lands as a normal message — refresh pending list.
        if (scheduledMessagesRef.current.length > 0) {
          void loadScheduled();
        }
        clearUnread(id);
        void api(`/chat/conversations/${id}/seen`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
          .then(() => clearUnread(id))
          .catch(() => clearUnread(id));
      }),
      subscribe('chat:message_deleted', (payload) => {
        const message = payload as ChatMessage;
        if (message.conversationId !== id) {
          return;
        }
        const normalized = normalizeMessage(message);
        setMessages((current) =>
          current.map((item) =>
            item.id === normalized.id ? normalized : item,
          ),
        );
        if (normalized.deletedForEveryone || !normalized.pinned) {
          setPinnedMessages((current) =>
            current.filter((item) => item.id !== normalized.id),
          );
        }
      }),
      subscribe('chat:typing', (payload) => {
        const event = payload as {
          conversationId: string;
          userId: string;
          typing: boolean;
        };
        if (event.conversationId === id && event.userId !== me) {
          setTyping(event.typing ? 'Typing…' : '');
        }
      }),
      subscribe('chat:presence', (payload) => {
        const event = payload as {
          userId: string;
          status: 'online' | 'offline';
          lastSeenAt?: string | null;
        };
        setConversation((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            members: current.members.map((member) =>
              member.userId === event.userId
                ? {
                    ...member,
                    status: event.status,
                    lastSeenAt:
                      event.status === 'online'
                        ? null
                        : (event.lastSeenAt ?? member.lastSeenAt),
                  }
                : member,
            ),
          };
        });
      }),
      subscribe('chat:seen', (payload) => {
        const event = payload as SeenResult;
        if (event.conversationId !== id || !event.userId) {
          return;
        }
        setMessages((current) =>
          current.map((message) => {
            if (message.senderId === event.userId) {
              return message;
            }
            if (message.seenBy.includes(event.userId)) {
              return message;
            }
            const readAt = new Date(event.lastReadAt).getTime();
            const createdAt = new Date(message.createdAt).getTime();
            if (Number.isFinite(readAt) && createdAt > readAt) {
              return message;
            }
            return {
              ...message,
              seenBy: [...message.seenBy, event.userId],
            };
          }),
        );
      }),
      subscribe('chat:group_deleted', (payload) => {
        const event = payload as { conversationId: string };
        if (event.conversationId === id) {
          setDetails(false);
          navigate('/chat');
        }
      }),
      subscribe('chat:conversation_updated', (payload) => {
        const next = payload as Conversation;
        if (next?.id === id) {
          setConversation((current) =>
            current
              ? {
                  ...next,
                  unreadCount: current.unreadCount,
                  muted: current.muted,
                  pinned: current.pinned,
                  lastReadAt: current.lastReadAt,
                  disappearingDurationSeconds:
                    next.disappearingDurationSeconds ??
                    current.disappearingDurationSeconds ??
                    0,
                }
              : next,
          );
          void refreshInbox();
        }
      }),
      subscribe('chat:removed_from_group', (payload) => {
        const event = payload as { conversationId: string };
        if (event.conversationId === id) {
          leaveConversation(id);
          setDetails(false);
          navigate('/chat');
        }
      }),
    ];

    return () => {
      leaveConversation(id);
      unsubs.forEach((unsub) => unsub());
    };
  }, [
    id,
    me,
    clearUnread,
    joinConversation,
    leaveConversation,
    navigate,
    refreshInbox,
    subscribe,
  ]);

  useEffect(() => {
    if (!toolsMenuOpen) {
      return;
    }
    const onPointerDown = (event: Event) => {
      const root = toolsMenuRef.current;
      if (root && !root.contains(event.target as Node)) {
        setToolsMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setToolsMenuOpen(false);
      }
    };
    const onResize = () => {
      if (window.innerWidth > 560) {
        setToolsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [toolsMenuOpen]);

  useEffect(() => {
    if (!attachMenuOpen) {
      return;
    }
    const onPointerDown = (event: Event) => {
      const root = attachMenuRef.current;
      if (root && !root.contains(event.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [attachMenuOpen]);

  // Keep Join banner in sync if the socket ring was missed
  useEffect(() => {
    if (!conversation || conversation.type !== 'group') {
      return;
    }
    void refreshLobby(id);
    const tick = window.setInterval(() => {
      if (callPhase === 'idle') {
        void refreshLobby(id);
      }
    }, 20_000);
    const onFocus = () => {
      if (callPhase === 'idle') {
        void refreshLobby(id);
      }
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener('focus', onFocus);
    };
  }, [callPhase, conversation?.type, id, refreshLobby]);

  useEffect(() => {
    if (editingMessage) {
      return;
    }
    const handle = window.setTimeout(() => {
      setMessageDraft(id, composer);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [composer, editingMessage, id]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) {
      return;
    }
    const onScroll = () => {
      if (node.scrollTop < 80) {
        void loadOlder();
      }
    };
    node.addEventListener('scroll', onScroll);
    return () => node.removeEventListener('scroll', onScroll);
  }, [hasOlder, loadingOlder, messagePage]);

  useEffect(() => {
    const url = firstUrl(composer);
    if (!url || editingMessage) {
      setPendingLinkPreview(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void api<LinkPreview>('/chat/link-preview', {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
        .then((response) => setPendingLinkPreview(response.data))
        .catch(() => setPendingLinkPreview(null));
    }, 450);
    return () => window.clearTimeout(handle);
  }, [composer, editingMessage]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length, typing]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        setSearchBusy(true);
        try {
          const response = await api<Paginated<ChatMessage>>(
            `/chat/conversations/${id}/messages/search?q=${encodeURIComponent(searchQuery.trim())}&page=1&limit=30`,
          );
          setSearchResults(response.data.items.map(normalizeMessage));
        } catch {
          setSearchResults([]);
        } finally {
          setSearchBusy(false);
        }
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchOpen, searchQuery, id]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = composer.trim();
    if (editingMessage) {
      if (!body) {
        return;
      }
      try {
        const response = await api<ChatMessage>(
          `/chat/conversations/${id}/messages/${editingMessage.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ body }),
          },
        );
        setMessages((current) => upsertMessage(current, response.data));
        setComposer('');
        clearMessageDraft(id);
        setEditingMessage(null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not edit message');
      }
      return;
    }

    if (!body) {
      return;
    }
    const mentionUserIds = extractMentionIds(body, mentionCandidates);
    const payload: {
      body: string;
      type: string;
      replyToMessageId?: string;
      mentionUserIds?: string[];
      linkPreview?: LinkPreview | null;
    } = {
      body,
      type: 'text',
      mentionUserIds,
      linkPreview: pendingLinkPreview,
    };
    if (replyTo) {
      payload.replyToMessageId = replyTo.id;
    }
    const response = await api<ChatMessage>(`/chat/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setMessages((current) => upsertMessage(current, response.data));
    setComposer('');
    clearMessageDraft(id);
    setReplyTo(null);
    setPendingLinkPreview(null);
    void sendTyping(false);
  }

  async function scheduleSend() {
    const body = composer.trim();
    if (!body || editingMessage || scheduleBusy) {
      return;
    }
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime())) {
      setActionError('Pick a valid date and time');
      return;
    }
    if (when.getTime() < Date.now() + 55_000) {
      setActionError('Schedule at least 1 minute from now');
      return;
    }
    setScheduleBusy(true);
    setActionError('');
    try {
      const mentionUserIds = extractMentionIds(body, mentionCandidates);
      const payload: {
        body: string;
        type: string;
        scheduledFor: string;
        replyToMessageId?: string;
        mentionUserIds?: string[];
        linkPreview?: LinkPreview | null;
      } = {
        body,
        type: 'text',
        scheduledFor: when.toISOString(),
        mentionUserIds,
        linkPreview: pendingLinkPreview,
      };
      if (replyTo) {
        payload.replyToMessageId = replyTo.id;
      }
      const response = await api<ScheduledMessage>(
        `/chat/conversations/${id}/scheduled-messages`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
      setScheduledMessages((current) =>
        [...current, response.data].sort(
          (a, b) =>
            new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime(),
        ),
      );
      setComposer('');
      clearMessageDraft(id);
      setReplyTo(null);
      setPendingLinkPreview(null);
      setScheduleOpen(false);
      setScheduleAt(defaultScheduleLocalValue());
      void sendTyping(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not schedule message');
    } finally {
      setScheduleBusy(false);
    }
  }

  async function cancelScheduled(scheduledMessageId: string) {
    try {
      await api(`/chat/conversations/${id}/scheduled-messages/${scheduledMessageId}`, {
        method: 'DELETE',
      });
      setScheduledMessages((current) =>
        current.filter((item) => item.id !== scheduledMessageId),
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not cancel scheduled message',
      );
    }
  }

  async function summarizeThread() {
    setSummaryBusy(true);
    try {
      const response = await api<{ summary: string; poweredByAi: boolean }>(
        `/chat/conversations/${id}/summarize`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setSummary(response.data.summary);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not summarize thread');
    } finally {
      setSummaryBusy(false);
    }
  }

  async function loadMedia(page = 1, kind: MediaKindTab = mediaKind, append = false) {
    if (!id) {
      return;
    }
    setMediaBusy(true);
    try {
      const response = await api<Paginated<ChatMessage>>(
        `/chat/conversations/${id}/media?page=${page}&limit=40&kind=${kind}`,
      );
      const items = response.data.items
        .map(normalizeMessage)
        .filter((item) => item.attachment && !item.deletedForEveryone);
      setMediaItems((current) => (append ? [...current, ...items] : items));
      setMediaPage(page);
      setMediaHasMore(Boolean(response.data.meta.hasNextPage));
    } catch (err) {
      if (!append) {
        setMediaItems([]);
      }
      setActionError(err instanceof Error ? err.message : 'Could not load media');
    } finally {
      setMediaBusy(false);
    }
  }

  function openMedia(kind: MediaKindTab = 'all') {
    setToolsMenuOpen(false);
    setSearchOpen(false);
    setMediaKind(kind);
    setMediaOpen(true);
    setMediaItems([]);
    setMediaPage(1);
    setMediaHasMore(false);
    void loadMedia(1, kind, false);
  }

  async function handleDownloadMedia(message: ChatMessage) {
    if (!message.attachment?.url) {
      return;
    }
    setMediaDownloadingId(message.id);
    try {
      await downloadMedia(message.attachment.url, mediaDownloadName(message), {
        conversationId: id,
        messageId: message.id,
        mime: message.attachment.mime,
      });
    } finally {
      setMediaDownloadingId(null);
    }
  }

  async function handleOpenMedia(message: ChatMessage) {
    if (!message.attachment?.url || isPendingMessage(message)) {
      return;
    }
    setMediaDownloadingId(message.id);
    try {
      await openAttachmentMedia(message.attachment.url, mediaDownloadName(message), {
        conversationId: id,
        messageId: message.id,
        mime: message.attachment.mime,
      });
    } finally {
      setMediaDownloadingId(null);
    }
  }

  function insertMention(label: string) {
    if (mentionQuery === null) {
      return;
    }
    const handle = label.replace(/\s+/g, '');
    const next = `${composer.slice(0, mentionQuery.start)}@${handle} `;
    setComposer(next);
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function revokePreviewUrl() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }

  function resetVoiceSession() {
    clearRecordingTimer();
    stopMediaStream();
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    discardOnStopRef.current = false;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }
    revokePreviewUrl();
    setPreviewFile(null);
    setPreviewPlaying(false);
    setRecordingMs(0);
    setVoicePhase('idle');
  }

  async function startVoiceRecording() {
    try {
      setActionError('');
      revokePreviewUrl();
      setPreviewFile(null);
      setPreviewPlaying(false);
      discardOnStopRef.current = false;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const preferredMime = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find((type) =>
        typeof MediaRecorder !== 'undefined' &&
        typeof MediaRecorder.isTypeSupported === 'function'
          ? MediaRecorder.isTypeSupported(type)
          : false,
      );
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stopMediaStream();
        clearRecordingTimer();
        mediaRecorderRef.current = null;
        if (discardOnStopRef.current) {
          discardOnStopRef.current = false;
          audioChunksRef.current = [];
          setRecordingMs(0);
          setVoicePhase('idle');
          return;
        }
        const mimeType = (recorder.mimeType || 'audio/webm').split(';')[0];
        const safeMime =
          mimeType.startsWith('audio/') || mimeType === 'video/webm'
            ? mimeType === 'video/webm'
              ? 'audio/webm'
              : mimeType
            : 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: safeMime });
        if (blob.size === 0) {
          setVoicePhase('idle');
          setRecordingMs(0);
          setActionError('Recording was empty — try again');
          return;
        }
        const extension = safeMime.includes('ogg')
          ? 'ogg'
          : safeMime.includes('mp4')
            ? 'm4a'
            : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${extension}`, {
          type: safeMime,
        });
        const objectUrl = URL.createObjectURL(blob);
        previewUrlRef.current = objectUrl;
        setPreviewFile(file);
        setPreviewUrl(objectUrl);
        setVoicePhase('preview');
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      recordingStartedAtRef.current = Date.now();
      setRecordingMs(0);
      clearRecordingTimer();
      recordingTimerRef.current = setInterval(() => {
        setRecordingMs(Date.now() - recordingStartedAtRef.current);
      }, 200);
      setVoicePhase('recording');
    } catch {
      resetVoiceSession();
      setActionError('Microphone access is required for voice notes');
    }
  }

  function stopVoiceRecording() {
    if (voicePhase !== 'recording') {
      return;
    }
    discardOnStopRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  function discardVoice() {
    if (voicePhase === 'recording') {
      discardOnStopRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        resetVoiceSession();
      }
      return;
    }
    resetVoiceSession();
  }

  async function restartVoiceRecording() {
    resetVoiceSession();
    await startVoiceRecording();
  }

  async function sendVoicePreview() {
    if (!previewFile) {
      return;
    }
    const file = previewFile;
    resetVoiceSession();
    await uploadAndSend(file, 'audio');
  }

  function togglePreviewPlayback() {
    const audio = previewAudioRef.current;
    if (!audio || !previewUrl) {
      return;
    }
    if (previewPlaying) {
      audio.pause();
      setPreviewPlaying(false);
      return;
    }
    void audio.play().then(() => setPreviewPlaying(true)).catch(() => {
      setPreviewPlaying(false);
    });
  }

  async function uploadAndSend(
    file: File,
    kind?: 'image' | 'audio' | 'file',
  ) {
    if (!me) {
      setActionError('You must be signed in to send media');
      return;
    }

    const resolvedKind: 'image' | 'audio' | 'file' =
      kind === 'audio'
        ? 'audio'
        : kind === 'image'
          ? 'image'
          : kind === 'file'
            ? 'file'
            : fileKindFromMime(file.type, file.name);

    const clientId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `local-${crypto.randomUUID()}`
        : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const localUrl = URL.createObjectURL(file);
    const caption = composer.trim();
    const replySnapshot = replyTo;
    const placeholder =
      resolvedKind === 'audio'
        ? '[Voice note]'
        : resolvedKind === 'file'
          ? '[File]'
          : '[Image]';
    const pendingMessage: ChatMessage = {
      id: clientId,
      conversationId: id,
      senderId: me,
      body: caption || placeholder,
      type: resolvedKind,
      replyTo: replySnapshot
        ? {
            id: replySnapshot.id,
            senderId: replySnapshot.senderId,
            body: replySnippet(replySnapshot),
            type: replySnapshot.type,
            deletedForEveryone: replySnapshot.deletedForEveryone,
          }
        : null,
      attachment: {
        url: localUrl,
        mime:
          file.type ||
          (resolvedKind === 'audio'
            ? 'audio/webm'
            : resolvedKind === 'file'
              ? 'application/octet-stream'
              : 'image/jpeg'),
        name: file.name,
        size: file.size,
      },
      mentions: [],
      linkPreview: null,
      reactions: [],
      editedAt: null,
      forwarded: false,
      deletedForEveryone: false,
      seenBy: [],
      createdAt: new Date().toISOString(),
      sendStatus: 'uploading',
      uploadProgress: 0,
    };

    setMessages((current) => [...current, pendingMessage]);
    setUploading(true);
    setAttachMenuOpen(false);
    setActionError('');
    setComposer('');
    clearMessageDraft(id);
    setReplyTo(null);
    setEditingMessage(null);

    const updatePending = (patch: Partial<ChatMessage>) => {
      setMessages((current) =>
        current.map((item) =>
          item.id === clientId ? { ...item, ...patch } : item,
        ),
      );
    };

    try {
      const attachment = await uploadFileWithProgress(file, (percent) => {
        updatePending({
          sendStatus: 'uploading',
          uploadProgress: percent,
        });
      });
      updatePending({ sendStatus: 'sending', uploadProgress: 100 });

      const response = await api<ChatMessage>(`/chat/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: caption || undefined,
          type: resolvedKind,
          attachmentUrl: attachment.url,
          attachmentMime: attachment.mime,
          attachmentName: attachment.name,
          attachmentSize: attachment.size,
          replyToMessageId: replySnapshot?.id,
        }),
      });
      setMessages((current) =>
        replacePendingWithServer(current, clientId, response.data),
      );
    } catch (err) {
      updatePending({ sendStatus: 'failed', uploadProgress: 0 });
      setActionError(err instanceof Error ? err.message : 'Could not upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (docInputRef.current) {
        docInputRef.current.value = '';
      }
    }
  }

  async function retryPendingMessage(message: ChatMessage) {
    if (message.sendStatus !== 'failed' || !message.attachment) {
      return;
    }
    try {
      const response = await fetch(message.attachment.url);
      const blob = await response.blob();
      const file = new File([blob], message.attachment.name || 'attachment', {
        type: message.attachment.mime || blob.type || 'application/octet-stream',
      });
      setMessages((current) => {
        const pending = current.find((item) => item.id === message.id);
        if (pending) {
          revokeAttachmentBlob(pending);
        }
        return current.filter((item) => item.id !== message.id);
      });
      const kind =
        message.type === 'audio'
          ? 'audio'
          : message.type === 'file'
            ? 'file'
            : fileKindFromMime(file.type, file.name);
      await uploadAndSend(file, kind);
    } catch {
      setActionError('Could not retry sending');
    }
  }

  async function toggleReaction(message: ChatMessage, emoji: string) {
    setReactPickerId(null);
    setMenuMessageId(null);
    try {
      const response = await api<ChatMessage>(
        `/chat/conversations/${id}/messages/${message.id}/reactions`,
        {
          method: 'POST',
          body: JSON.stringify({ emoji }),
        },
      );
      setMessages((current) => upsertMessage(current, response.data));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update reaction');
    }
  }

  async function toggleMessagePin(message: ChatMessage) {
    setMenuMessageId(null);
    try {
      const response = await api<ChatMessage>(
        `/chat/conversations/${id}/messages/${message.id}/pin`,
        {
          method: 'POST',
          body: JSON.stringify({ pinned: !message.pinned }),
        },
      );
      const normalized = normalizeMessage(response.data);
      setMessages((current) => upsertMessage(current, normalized));
      setPinnedMessages((current) => {
        const without = current.filter((item) => item.id !== normalized.id);
        if (normalized.pinned) {
          return [normalized, ...without].sort((a, b) =>
            (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''),
          );
        }
        return without;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update pin');
    }
  }

  async function forwardTo(conversationId: string) {
    if (!forwardMessage) {
      return;
    }
    try {
      await api<ChatMessage>(
        `/chat/conversations/${id}/messages/${forwardMessage.id}/forward`,
        {
          method: 'POST',
          body: JSON.stringify({ conversationId }),
        },
      );
      setForwardMessage(null);
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not forward message');
    }
  }

  async function sendTyping(isTyping: boolean) {
    await api(`/chat/conversations/${id}/typing`, {
      method: 'POST',
      body: JSON.stringify({ typing: isTyping }),
    }).catch(() => undefined);
    emit('chat:typing', { conversationId: id, typing: isTyping });
  }

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '');
    const response = await api<Conversation>(`/chat/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    setConversation(response.data);
    void refreshInbox();
  }

  async function addMember(userId: string) {
    try {
      await api(`/chat/conversations/${id}/members`, {
        method: 'POST',
        body: JSON.stringify({ memberIds: [userId] }),
      });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not add that person');
    }
  }

  async function removeMember(userId: string) {
    try {
      await api(`/chat/conversations/${id}/members/${userId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove that person');
    }
  }

  async function setMemberRole(userId: string, role: 'admin' | 'member') {
    try {
      const response = await api<Conversation>(
        `/chat/conversations/${id}/members/${userId}/role`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        },
      );
      setConversation(response.data);
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update role');
    }
  }

  async function toggleMute() {
    if (!conversation) {
      return;
    }
    try {
      const response = await api<Conversation>(`/chat/conversations/${id}/mute`, {
        method: 'POST',
        body: JSON.stringify({ muted: !conversation.muted }),
      });
      setConversation(response.data);
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update mute');
    }
  }

  async function togglePin() {
    if (!conversation) {
      return;
    }
    try {
      const response = await api<Conversation>(`/chat/conversations/${id}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned: !conversation.pinned }),
      });
      setConversation({
        ...response.data,
        pinned: Boolean(response.data.pinned),
      });
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update pin');
    }
  }

  async function setDisappearing(durationSeconds: number) {
    if (!conversation) {
      return;
    }
    try {
      const response = await api<Conversation>(
        `/chat/conversations/${id}/disappearing`,
        {
          method: 'POST',
          body: JSON.stringify({ durationSeconds }),
        },
      );
      setConversation({
        ...response.data,
        muted: Boolean(response.data.muted),
        pinned: Boolean(response.data.pinned),
        disappearingDurationSeconds:
          response.data.disappearingDurationSeconds ?? 0,
      });
      void refreshInbox();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not update disappearing messages',
      );
    }
  }

  async function blockPeer() {
    if (!peer) {
      return;
    }
    if (!window.confirm('Block this user? They will not be able to message you.')) {
      return;
    }
    try {
      await api('/chat/blocks', {
        method: 'POST',
        body: JSON.stringify({ userId: peer.userId }),
      });
      setDetails(false);
      navigate('/chat');
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not block user');
    }
  }

  async function deleteMessage(message: ChatMessage, forEveryone: boolean) {
    setMenuMessageId(null);
    try {
      const response = await api<ChatMessage>(
        `/chat/conversations/${id}/messages/${message.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ forEveryone }),
        },
      );
      if (forEveryone) {
        setMessages((current) => upsertMessage(current, response.data));
      } else {
        setMessages((current) => current.filter((item) => item.id !== message.id));
      }
      if (replyTo?.id === message.id) {
        setReplyTo(null);
      }
      if (editingMessage?.id === message.id) {
        setEditingMessage(null);
        setComposer(getMessageDraft(id));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete message');
    }
  }

  async function leave() {
    try {
      await api(`/chat/conversations/${id}/leave`, { method: 'POST' });
      setDetails(false);
      navigate('/chat');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not leave the group');
    }
  }

  async function deleteGroup() {
    if (
      !window.confirm(
        'Delete this group for everyone? This cannot be undone.',
      )
    ) {
      return;
    }
    try {
      await api(`/chat/conversations/${id}`, { method: 'DELETE' });
      setDetails(false);
      navigate('/chat');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete the group');
    }
  }

  function jumpToMessage(messageId: string) {
    setHighlightId(messageId);
    const el = messageRefs.current.get(messageId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setHighlightId(null), 1600);
  }

  useEffect(() => {
    if (!focusMessageId || loading || focusBusyRef.current) {
      return;
    }

    const targetId = focusMessageId;
    let cancelled = false;
    focusBusyRef.current = true;

    const clearFocusParam = () => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('focus');
          return next;
        },
        { replace: true },
      );
    };

    async function resolveFocus() {
      try {
        if (messagesRef.current.some((item) => item.id === targetId)) {
          requestAnimationFrame(() => {
            if (!cancelled) {
              jumpToMessage(targetId);
            }
          });
          return;
        }

        let page = messagePageRef.current;
        let more = hasOlderRef.current;
        let found = false;
        const scrollerEl = scroller.current;

        while (more && !cancelled && !found) {
          setLoadingOlder(true);
          const previousHeight = scrollerEl?.scrollHeight ?? 0;
          page += 1;
          const history = await api<Paginated<ChatMessage>>(
            `/chat/conversations/${id}/messages?page=${page}&limit=80`,
          );
          const batch = [...history.data.items].reverse().map(normalizeMessage);
          found = batch.some((item) => item.id === targetId);
          setMessages((current) => [...batch, ...current]);
          more = history.data.meta.hasNextPage;
          setHasOlder(more);
          setMessagePage(page);
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              if (scrollerEl) {
                scrollerEl.scrollTop = scrollerEl.scrollHeight - previousHeight;
              }
              resolve();
            });
          });
        }

        if (!cancelled && found) {
          await new Promise((resolve) => window.setTimeout(resolve, 100));
          if (!cancelled) {
            jumpToMessage(targetId);
          }
        }
      } finally {
        if (!cancelled) {
          setLoadingOlder(false);
          clearFocusParam();
          focusBusyRef.current = false;
        }
      }
    }

    void resolveFocus();
    return () => {
      cancelled = true;
      focusBusyRef.current = false;
    };
  }, [focusMessageId, loading, id, setSearchParams]);

  function startReply(message: ChatMessage) {
    if (message.deletedForEveryone || isPendingMessage(message)) {
      return;
    }
    setReplyTo(message);
    setEditingMessage(null);
    setMenuMessageId(null);
    setReactPickerId(null);
    window.setTimeout(() => composerInputRef.current?.focus(), 50);
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  function canDeleteForEveryone(message: ChatMessage) {
    if (
      !me ||
      message.senderId !== me ||
      message.deletedForEveryone ||
      isPendingMessage(message)
    ) {
      return false;
    }
    if (!Number.isFinite(DELETE_FOR_EVERYONE_MS)) {
      return true;
    }
    return Date.now() - new Date(message.createdAt).getTime() < DELETE_FOR_EVERYONE_MS;
  }

  function canEdit(message: ChatMessage) {
    if (
      !me ||
      message.senderId !== me ||
      message.deletedForEveryone ||
      isPendingMessage(message)
    ) {
      return false;
    }
    return Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;
  }

  function startEdit(message: ChatMessage) {
    setEditingMessage(message);
    setComposer(message.body && !isPlaceholderBody(message.body) ? message.body : '');
    setReplyTo(null);
    setMenuMessageId(null);
  }

  if (loading) {
    return (
      <div className="thread empty-thread">
        <div className="empty-panel">
          <p className="muted">Opening conversation…</p>
        </div>
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="thread empty-thread">
        <div className="empty-panel">
          <span className="empty-glyph warn" aria-hidden="true" />
          <h2>Conversation unavailable</h2>
          <p className="muted">
            {error === 'Conversation not found' || !conversation
              ? 'This chat was deleted or you no longer have access.'
              : error}
          </p>
          <div className="empty-actions">
            <button className="btn" type="button" onClick={() => navigate('/chat')}>
              Back to messages
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="thread">
      <header className="thread-head">
        <div className="thread-head-main">
          <button
            className="ghost icon-btn thread-back"
            type="button"
            aria-label="Back to messages"
            onClick={() => navigate('/chat')}
          >
            ←
          </button>
          <div>
            <h2>
              {conversation.pinned ? <span className="pin-badge" title="Pinned">📌</span> : null}
              {title}
              {conversation.muted ? <span className="mute-pill">Muted</span> : null}
            </h2>
            <p className="muted thread-status">
              <span className={peerOnline || groupOnlineCount > 0 ? 'dot on' : 'dot'} />
              {statusLabel}
            </p>
          </div>
        </div>
        <div className="thread-tools" ref={toolsMenuRef}>
          <div className="thread-tools-primary">
            {(conversation.type === 'private' && peer) ||
            conversation.type === 'group' ? (
              canJoinOngoing ? (
                <button
                  className="ghost thread-tool-btn call join"
                  type="button"
                  aria-label="Join group call"
                  title="Join call"
                  onClick={() => void joinCall(conversation.id)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 7.7 7.7 0 0 0 2.4.4 1.2 1.2 0 0 1 1.2 1.2V20a1.2 1.2 0 0 1-1.2 1.2A17.2 17.2 0 0 1 2.8 4 1.2 1.2 0 0 1 4 2.8h3.5A1.2 1.2 0 0 1 8.7 4a7.7 7.7 0 0 0 .4 2.4 1.2 1.2 0 0 1-.3 1.2z"
                    />
                  </svg>
                </button>
              ) : (
                <>
                  <button
                    className="ghost thread-tool-btn call"
                    type="button"
                    aria-label={
                      conversation.type === 'group'
                        ? 'Start group voice call'
                        : 'Start voice call'
                    }
                    title={conversation.type === 'group' ? 'Group voice call' : 'Voice call'}
                    disabled={callPhase !== 'idle'}
                    onClick={() =>
                      void startCall(
                        conversation.id,
                        conversation.type === 'private' ? peer?.userId : undefined,
                        'audio',
                      )
                    }
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 7.7 7.7 0 0 0 2.4.4 1.2 1.2 0 0 1 1.2 1.2V20a1.2 1.2 0 0 1-1.2 1.2A17.2 17.2 0 0 1 2.8 4 1.2 1.2 0 0 1 4 2.8h3.5A1.2 1.2 0 0 1 8.7 4a7.7 7.7 0 0 0 .4 2.4 1.2 1.2 0 0 1-.3 1.2z"
                      />
                    </svg>
                  </button>
                  <button
                    className="ghost thread-tool-btn call video"
                    type="button"
                    aria-label={
                      conversation.type === 'group'
                        ? 'Start group video call'
                        : 'Start video call'
                    }
                    title={conversation.type === 'group' ? 'Group video call' : 'Video call'}
                    disabled={callPhase !== 'idle'}
                    onClick={() =>
                      void startCall(
                        conversation.id,
                        conversation.type === 'private' ? peer?.userId : undefined,
                        'video',
                      )
                    }
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M17 10.5V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3.5l5 4v-11l-5 4z"
                      />
                    </svg>
                  </button>
                </>
              )
            ) : null}
          </div>

          <div className="thread-tools-secondary">
            <button
              className={`ghost thread-tool-btn${mediaOpen ? ' active' : ''}`}
              type="button"
              aria-label="Media"
              title="Media"
              aria-pressed={mediaOpen}
              onClick={() => {
                if (mediaOpen) {
                  setMediaOpen(false);
                } else {
                  openMedia('all');
                }
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
                />
              </svg>
            </button>
            <button
              className={`ghost thread-tool-btn${searchOpen ? ' active' : ''}`}
              type="button"
              aria-label="Search messages"
              title="Search"
              aria-pressed={searchOpen}
              onClick={() => {
                setToolsMenuOpen(false);
                setMediaOpen(false);
                setSearchOpen((open) => !open);
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"
                />
              </svg>
            </button>
            <button
              className={`ghost thread-tool-btn${conversation.pinned ? ' active' : ''}`}
              type="button"
              aria-label={conversation.pinned ? 'Unpin chat' : 'Pin chat'}
              title={conversation.pinned ? 'Unpin' : 'Pin'}
              onClick={() => {
                setToolsMenuOpen(false);
                void togglePin();
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2zm-1.5 2h-5L11 12.5V4h2v8.5l1.5 1.5z"
                />
              </svg>
            </button>
            <button
              className={`ghost thread-tool-btn${conversation.muted ? ' active' : ''}`}
              type="button"
              aria-label={conversation.muted ? 'Unmute chat' : 'Mute chat'}
              title={conversation.muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                setToolsMenuOpen(false);
                void toggleMute();
              }}
            >
              {conversation.muted ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M4.3 3 3 4.3 7.7 9H4v6h3l5 5v-6.7l4.5 4.5c-.7.5-1.5.9-2.5 1.1v2.1a8.9 8.9 0 0 0 4.1-1.8L19.7 21 21 19.7 4.3 3zM12 4 9.9 6.1 12 8.2V4zm7.6 6.6-1.5 1.5A4.9 4.9 0 0 1 17 12c0 1.2-.4 2.3-1.2 3.1l1.4 1.4A6.9 6.9 0 0 0 19 12c0-.9-.2-1.7-.4-2.4z"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 3 7 8H4v8h3l5 5V3zm5.5 9c0 1.8-.8 3.4-2 4.5v2.2A6.9 6.9 0 0 0 19.5 12 6.9 6.9 0 0 0 15.5 5.3v2.2c1.2 1.1 2 2.7 2 4.5z"
                  />
                </svg>
              )}
            </button>
            <button
              className="ghost thread-tool-btn"
              type="button"
              aria-label={conversation.type === 'group' ? 'Group details' : 'Chat info'}
              title={conversation.type === 'group' ? 'Details' : 'Chat info'}
              onClick={() => {
                setToolsMenuOpen(false);
                setDetails(true);
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
                />
              </svg>
            </button>
          </div>

          <button
            className={`ghost thread-tool-btn thread-tools-more${
              toolsMenuOpen ? ' active' : ''
            }`}
            type="button"
            aria-label="More actions"
            aria-expanded={toolsMenuOpen}
            aria-haspopup="menu"
            title="More"
            onClick={() => setToolsMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
              />
            </svg>
          </button>

          {toolsMenuOpen ? (
            <div className="thread-tools-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => openMedia('all')}
              >
                Media
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  setMediaOpen(false);
                  setSearchOpen(true);
                }}
              >
                Search
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  void togglePin();
                }}
              >
                {conversation.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  void toggleMute();
                }}
              >
                {conversation.muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  setDetails(true);
                }}
              >
                {conversation.type === 'group' ? 'Group details' : 'Chat info'}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {canJoinOngoing ? (
        <button
          className="wa-ongoing-call"
          type="button"
          onClick={() => void joinCall(conversation.id)}
          aria-label={
            ongoingLobby?.media === 'video'
              ? 'Join ongoing group video call as voice'
              : 'Join ongoing group voice call'
          }
        >
          <span className="wa-ongoing-call-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 7.7 7.7 0 0 0 2.4.4 1.2 1.2 0 0 1 1.2 1.2V20a1.2 1.2 0 0 1-1.2 1.2A17.2 17.2 0 0 1 2.8 4 1.2 1.2 0 0 1 4 2.8h3.5A1.2 1.2 0 0 1 8.7 4a7.7 7.7 0 0 0 .4 2.4 1.2 1.2 0 0 1-.3 1.2z"
              />
            </svg>
            <span className="wa-ongoing-call-pulse" />
          </span>

          <span className="wa-ongoing-call-avatars" aria-hidden="true">
            {ongoingCallParticipants.slice(0, 3).map((participant, index) => (
              <span
                key={participant.userId}
                className="wa-ongoing-call-avatar"
                style={{ zIndex: 3 - index }}
                title={participant.name}
              >
                {participant.avatar ? (
                  <img src={participant.avatar} alt="" />
                ) : (
                  participant.initials
                )}
              </span>
            ))}
            {(ongoingLobby?.joinedIds.length ?? 0) > 3 ? (
              <span className="wa-ongoing-call-avatar more">
                +{(ongoingLobby?.joinedIds.length ?? 0) - 3}
              </span>
            ) : null}
          </span>

          <span className="wa-ongoing-call-meta">
            <strong>
              {ongoingLobby?.media === 'video'
                ? 'Ongoing video call'
                : 'Ongoing voice call'}
            </strong>
            <span>
              {ongoingLobby?.joinedIds.length ?? 0}{' '}
              {(ongoingLobby?.joinedIds.length ?? 0) === 1
                ? 'participant'
                : 'participants'}
              {ongoingLobby?.media === 'video'
                ? ' · Tap to join (voice)'
                : ' · Tap to join'}
            </span>
          </span>

          <span className="wa-ongoing-call-join">Join</span>
        </button>
      ) : null}

      {pinnedMessages.length > 0 ? (
        <div className="pinned-banner">
          <button
            type="button"
            className="pinned-banner-main"
            onClick={() => {
              if (pinnedMessages.length === 1) {
                jumpToMessage(pinnedMessages[0].id);
                return;
              }
              setPinnedBannerOpen((open) => !open);
            }}
          >
            <span className="pinned-banner-icon" aria-hidden="true">
              📌
            </span>
            <span className="pinned-banner-copy">
              <strong>
                {pinnedMessages.length === 1
                  ? 'Pinned message'
                  : `${pinnedMessages.length} pinned messages`}
              </strong>
              <small>
                {replySnippet(pinnedMessages[0])}
              </small>
            </span>
          </button>
          {pinnedMessages.length === 1 ? (
            <button
              type="button"
              className="ghost pinned-banner-unpin"
              aria-label="Unpin message"
              title="Unpin"
              onClick={() => void toggleMessagePin(pinnedMessages[0])}
            >
              ×
            </button>
          ) : (
            <button
              type="button"
              className="ghost pinned-banner-unpin"
              aria-expanded={pinnedBannerOpen}
              aria-label={pinnedBannerOpen ? 'Hide pinned messages' : 'Show pinned messages'}
              onClick={() => setPinnedBannerOpen((open) => !open)}
            >
              {pinnedBannerOpen ? '▴' : '▾'}
            </button>
          )}
          {pinnedBannerOpen && pinnedMessages.length > 1 ? (
            <ul className="pinned-banner-list">
              {pinnedMessages.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPinnedBannerOpen(false);
                      jumpToMessage(item.id);
                    }}
                  >
                    <strong>{displayName(byUserId.get(item.senderId))}</strong>
                    <span>{replySnippet(item)}</span>
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void toggleMessagePin(item)}
                  >
                    Unpin
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {(conversation.disappearingDurationSeconds ?? 0) > 0 ? (
        <div className="disappearing-banner" role="status">
          <span aria-hidden="true">⌛</span>
          <p>
            Disappearing messages on · new messages vanish after{' '}
            {disappearingLabel(conversation.disappearingDurationSeconds)}
          </p>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="search-panel">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
            autoFocus
          />
          {searchBusy ? <p className="muted">Searching…</p> : null}
          {!searchBusy && searchQuery.trim() && searchResults.length === 0 ? (
            <p className="muted">No matches</p>
          ) : null}
          <ul className="search-results">
            {searchResults.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => jumpToMessage(item.id)}
                >
                  <strong>{displayName(byUserId.get(item.senderId))}</strong>
                  <span>{item.body}</span>
                  <time dateTime={item.createdAt}>{clock(item.createdAt)}</time>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actionError ? <p className="error pad">{actionError}</p> : null}

      <div className="thread-body wa-thread" ref={scroller}>
        {loadingOlder ? <p className="muted load-older">Loading earlier messages…</p> : null}
        {hasOlder && !loadingOlder ? (
          <button className="ghost load-older-btn" type="button" onClick={() => void loadOlder()}>
            Load earlier messages
          </button>
        ) : null}
        {messages.length === 0 ? (
          <div className="thread-empty-messages">
            <p className="muted">No messages yet. Say hello.</p>
          </div>
        ) : null}
        {messages.map((message) => {
          if (message.type === 'call' && !message.deletedForEveryone) {
            const history = parseCallHistoryBody(message.body);
            const label = history ? callHistoryLabel(history) : 'Call';
            const canJoinFromHistory =
              history &&
              conversation?.type === 'group' &&
              canJoinOngoing &&
              ongoingLobby?.callId === history.callId;
            return (
              <div
                key={message.id}
                className="wa-call-history"
                ref={(node) => {
                  if (node) {
                    messageRefs.current.set(message.id, node);
                  } else {
                    messageRefs.current.delete(message.id);
                  }
                }}
              >
                <div className="wa-call-history-pill">
                  <span className="wa-call-history-icon" aria-hidden="true">
                    {history?.media === 'video' ? '📹' : '📞'}
                  </span>
                  <span>{label}</span>
                  <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
                  {canJoinFromHistory ? (
                    <button
                      type="button"
                      className="wa-call-history-join"
                      onClick={() => void joinCall(conversation.id)}
                    >
                      Join
                    </button>
                  ) : null}
                </div>
              </div>
            );
          }

          const mine = message.senderId === me;
          const pending = isPendingMessage(message);
          const seen = Boolean(
            mine && me && !pending && message.seenBy.some((userId) => userId !== me),
          );
          const menuOpen = !pending && menuMessageId === message.id;
          const showImage =
            !message.deletedForEveryone &&
            message.attachment &&
            (message.type === 'image' ||
              message.attachment.mime.startsWith('image/')) &&
            message.type !== 'audio' &&
            message.type !== 'file';
          const showAudio =
            !message.deletedForEveryone &&
            message.attachment &&
            (message.type === 'audio' ||
              message.attachment.mime.startsWith('audio/') ||
              // Chrome sometimes records audio-only MediaRecorder blobs as video/webm
              (message.type === 'audio' &&
                message.attachment.mime.startsWith('video/')));
          const showFile =
            !message.deletedForEveryone &&
            message.attachment &&
            !showImage &&
            !showAudio &&
            (message.type === 'file' || Boolean(message.attachment.url));
          const caption =
            message.body && !isPlaceholderBody(message.body) ? message.body : null;
          const bodyParts = caption
            ? renderMessageBody(
                caption,
                new Map(
                  mentionCandidates.map((member) => [member.userId, member.label]),
                ),
              )
            : [];
          return (
            <div
              key={message.id}
              className={`${mine ? 'wa-row mine' : 'wa-row theirs'}${
                highlightId === message.id ? ' highlight' : ''
              }${pending ? ' is-pending' : ''}`}
              ref={(node) => {
                if (node) {
                  messageRefs.current.set(message.id, node);
                } else {
                  messageRefs.current.delete(message.id);
                }
              }}
              onTouchStart={(event) => {
                if (pending || message.deletedForEveryone) {
                  return;
                }
                const touch = event.touches[0];
                touchStartRef.current = {
                  x: touch.clientX,
                  y: touch.clientY,
                  id: message.id,
                };
                clearLongPressTimer();
                longPressTimerRef.current = setTimeout(() => {
                  setReactPickerId(null);
                  setMenuMessageId(message.id);
                  if (navigator.vibrate) {
                    navigator.vibrate(12);
                  }
                }, 480);
              }}
              onTouchMove={(event) => {
                const start = touchStartRef.current;
                if (!start || start.id !== message.id) {
                  return;
                }
                const touch = event.touches[0];
                if (
                  Math.abs(touch.clientX - start.x) > 12 ||
                  Math.abs(touch.clientY - start.y) > 12
                ) {
                  clearLongPressTimer();
                }
              }}
              onTouchEnd={(event) => {
                clearLongPressTimer();
                const start = touchStartRef.current;
                touchStartRef.current = null;
                if (!start || start.id !== message.id || pending || message.deletedForEveryone) {
                  return;
                }
                const touch = event.changedTouches[0];
                const dx = touch.clientX - start.x;
                const dy = Math.abs(touch.clientY - start.y);
                // Swipe right to reply (WhatsApp-style)
                if (dx > 64 && dy < 40) {
                  startReply(message);
                }
              }}
              onTouchCancel={() => {
                clearLongPressTimer();
                touchStartRef.current = null;
              }}
            >
              <div className={`wa-msg${mine ? ' mine' : ' theirs'}`}>
              <div
                className={mine ? 'wa-bubble mine' : 'wa-bubble theirs'}
                onContextMenu={(event) => {
                  if (pending) {
                    return;
                  }
                  event.preventDefault();
                  setMenuMessageId(message.id);
                  setReactPickerId(null);
                }}
              >
                {!mine && conversation.type === 'group' ? (
                  <span className="wa-author">
                    {displayName(byUserId.get(message.senderId))}
                  </span>
                ) : null}
                {message.forwarded && !message.deletedForEveryone ? (
                  <span className="wa-forwarded">Forwarded</span>
                ) : null}
                {message.pinned && !message.deletedForEveryone ? (
                  <span className="wa-pinned-label">📌 Pinned</span>
                ) : null}
                {message.replyTo ? (
                  <button
                    type="button"
                    className="wa-reply"
                    onClick={() => jumpToMessage(message.replyTo!.id)}
                  >
                    <strong>
                      {message.replyTo.deletedForEveryone
                        ? 'Deleted message'
                        : displayName(byUserId.get(message.replyTo.senderId))}
                    </strong>
                    <span>
                      {message.replyTo.deletedForEveryone
                        ? 'This message was deleted'
                        : replySnippet(message.replyTo)}
                    </span>
                  </button>
                ) : null}
                {message.deletedForEveryone ? (
                  <p className="wa-text wa-deleted">This message was deleted</p>
                ) : (
                  <>
                    {showImage && message.attachment ? (
                      <div className={`wa-media-wrap${pending ? ' is-sending' : ''}`}>
                        <a
                          className="wa-image-link"
                          href={resolveMediaUrl(message.attachment.url)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            if (pending) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <img
                            className="wa-image"
                            src={resolveMediaUrl(message.attachment.url)}
                            alt={message.attachment.name || 'Image'}
                            loading="lazy"
                          />
                          {pending ? (
                            <span className="wa-image-send-overlay">
                              {message.sendStatus === 'failed'
                                ? 'Failed'
                                : message.sendStatus === 'uploading'
                                  ? `${Math.round(message.uploadProgress ?? 0)}%`
                                  : 'Sending…'}
                            </span>
                          ) : null}
                        </a>
                        {!pending ? (
                          <button
                            type="button"
                            className="wa-media-download"
                            aria-label="Download image"
                            title="Download"
                            disabled={mediaDownloadingId === message.id}
                            onClick={() => void handleDownloadMedia(message)}
                          >
                            ↓
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {showAudio && message.attachment ? (
                      <div className="wa-media-wrap audio">
                        <VoiceNotePlayer
                          src={message.attachment.url}
                          mime={message.attachment.mime}
                          mine={mine}
                          sendStatus={message.sendStatus}
                          uploadProgress={message.uploadProgress}
                          onRetry={
                            message.sendStatus === 'failed'
                              ? () => void retryPendingMessage(message)
                              : undefined
                          }
                        />
                        {!pending ? (
                          <button
                            type="button"
                            className="wa-media-download"
                            aria-label="Download voice note"
                            title="Download"
                            disabled={mediaDownloadingId === message.id}
                            onClick={() => void handleDownloadMedia(message)}
                          >
                            ↓
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {showFile && message.attachment ? (
                      <div className={`wa-media-wrap${pending ? ' is-sending' : ''}`}>
                        <button
                          type="button"
                          className={`wa-file-card${pending ? ' is-sending' : ''}${
                            message.sendStatus === 'failed' ? ' is-failed' : ''
                          }`}
                          disabled={mediaDownloadingId === message.id}
                          onClick={() => {
                            if (pending) {
                              if (message.sendStatus === 'failed') {
                                void retryPendingMessage(message);
                              }
                              return;
                            }
                            void handleOpenMedia(message);
                          }}
                        >
                          <span className="wa-file-icon" aria-hidden="true">
                            {fileExtLabel(
                              message.attachment.name,
                              message.attachment.mime,
                            )}
                          </span>
                          <span className="wa-file-meta">
                            <strong className="wa-file-name">
                              {message.attachment.name || 'Document'}
                            </strong>
                            <small className="wa-file-sub">
                              {pending
                                ? message.sendStatus === 'failed'
                                  ? 'Failed · tap to retry'
                                  : message.sendStatus === 'uploading'
                                    ? `Uploading ${Math.round(message.uploadProgress ?? 0)}%`
                                    : 'Sending…'
                                : mediaDownloadingId === message.id
                                  ? 'Opening…'
                                  : [
                                      formatFileSize(message.attachment.size),
                                      fileExtLabel(
                                        message.attachment.name,
                                        message.attachment.mime,
                                      ),
                                      'Tap to open',
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                            </small>
                          </span>
                        </button>
                        {!pending ? (
                          <button
                            type="button"
                            className="wa-media-download"
                            aria-label="Download file"
                            title="Download"
                            disabled={mediaDownloadingId === message.id}
                            onClick={() => void handleDownloadMedia(message)}
                          >
                            ↓
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {caption ? (
                      <p className="wa-text">
                        {bodyParts.map((part, index) =>
                          part.type === 'mention' ? (
                            <mark key={`${message.id}-m-${index}`} className="wa-mention">
                              {part.value}
                            </mark>
                          ) : (
                            <span key={`${message.id}-t-${index}`}>{part.value}</span>
                          ),
                        )}
                      </p>
                    ) : null}
                    {message.linkPreview ? (
                      <a
                        className="link-preview-card"
                        href={message.linkPreview.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {message.linkPreview.image ? (
                          <img src={message.linkPreview.image} alt="" loading="lazy" />
                        ) : null}
                        <span>
                          <strong>{message.linkPreview.title}</strong>
                          <small>{message.linkPreview.description}</small>
                        </span>
                      </a>
                    ) : null}
                    {!showImage && !showAudio && !caption ? (
                      <p className="wa-text">{message.body}</p>
                    ) : null}
                  </>
                )}
                <span className="wa-meta">
                  {!pending && !message.deletedForEveryone ? (
                    <>
                      <button
                        className="msg-reply-btn"
                        type="button"
                        aria-label="Reply"
                        title="Reply"
                        onClick={() => startReply(message)}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
                          />
                        </svg>
                      </button>
                      <button
                        className="msg-menu-btn"
                        type="button"
                        aria-label="Message actions"
                        onClick={() => {
                          setReactPickerId(null);
                          setMenuMessageId((current) =>
                            current === message.id ? null : message.id,
                          );
                        }}
                      >
                        ⋮
                      </button>
                    </>
                  ) : pending && message.sendStatus === 'failed' ? (
                    <button
                      className="msg-retry-btn"
                      type="button"
                      onClick={() => void retryPendingMessage(message)}
                    >
                      Retry
                    </button>
                  ) : null}
                  {message.editedAt ? <span className="wa-edited">edited</span> : null}
                  {message.expiresAt && !message.deletedForEveryone ? (
                    <span
                      className="wa-expires"
                      title={`Disappears ${new Date(message.expiresAt).toLocaleString()}`}
                    >
                      ⌛
                    </span>
                  ) : null}
                  <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
                  {mine ? (
                    <MessageTicks
                      seen={seen}
                      status={
                        message.sendStatus === 'failed'
                          ? 'failed'
                          : message.sendStatus
                            ? 'pending'
                            : 'sent'
                      }
                    />
                  ) : null}
                </span>
                {reactPickerId === message.id ? (
                  <div className="reaction-picker">
                    {REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => void toggleReaction(message, emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
                {menuOpen ? (
                  <div className="msg-menu">
                    {!message.deletedForEveryone ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setReactPickerId(message.id);
                            setMenuMessageId(null);
                          }}
                        >
                          React
                        </button>
                        <button
                          type="button"
                          onClick={() => startReply(message)}
                        >
                          Reply
                        </button>
                        {canEdit(message) ? (
                          <button type="button" onClick={() => startEdit(message)}>
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setForwardMessage(message);
                            setMenuMessageId(null);
                          }}
                        >
                          Forward
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleMessagePin(message)}
                        >
                          {message.pinned ? 'Unpin' : 'Pin'}
                        </button>
                      </>
                    ) : null}
                    <button type="button" onClick={() => void deleteMessage(message, false)}>
                      {mine ? 'Delete for me only' : 'Delete for me'}
                    </button>
                    {canDeleteForEveryone(message) ? (
                      <button
                        type="button"
                        className="msg-menu-danger"
                        onClick={() => void deleteMessage(message, true)}
                      >
                        Delete for everyone
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {!pending &&
              !message.deletedForEveryone &&
              message.reactions.length > 0 ? (
                <div className="wa-reactions" aria-label="Reactions">
                  {message.reactions.map((reaction) => (
                    <button
                      key={reaction.emoji}
                      type="button"
                      className={
                        reaction.reactedByMe
                          ? 'wa-reaction active'
                          : 'wa-reaction'
                      }
                      onClick={() => void toggleReaction(message, reaction.emoji)}
                    >
                      <span>{reaction.emoji}</span>
                      <span>{reaction.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              </div>
            </div>
          );
        })}
        {typing ? <p className="typing wa-typing">{typing}</p> : null}
      </div>

      {editingMessage ? (
        <div className="reply-bar edit-bar">
          <div>
            <strong>Editing message</strong>
            <span>{editingMessage.body}</span>
          </div>
          <button
            className="ghost icon-btn"
            type="button"
            aria-label="Cancel edit"
            onClick={() => {
              setEditingMessage(null);
              setComposer(getMessageDraft(id));
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {replyTo && !editingMessage ? (
        <div className="reply-bar">
          <div>
            <strong>Replying to {displayName(byUserId.get(replyTo.senderId))}</strong>
            <span>{replySnippet(replyTo)}</span>
          </div>
          <button
            className="ghost icon-btn"
            type="button"
            aria-label="Cancel reply"
            onClick={() => setReplyTo(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      {pendingLinkPreview ? (
        <div className="pending-link-preview">
          <a href={pendingLinkPreview.url} target="_blank" rel="noreferrer">
            <strong>{pendingLinkPreview.title}</strong>
            <small>{pendingLinkPreview.description}</small>
          </a>
          <button
            className="ghost icon-btn"
            type="button"
            aria-label="Remove link preview"
            onClick={() => setPendingLinkPreview(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      {filteredMentions.length > 0 && mentionQuery ? (
        <ul className="mention-picker">
          {filteredMentions.slice(0, 6).map((member) => (
            <li key={member.userId}>
              <button type="button" onClick={() => insertMention(member.label)}>
                @{member.label.replace(/\s+/g, '')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {scheduledMessages.length > 0 ? (
        <div className="scheduled-panel">
          <p className="scheduled-panel-title">Scheduled</p>
          <ul className="scheduled-list">
            {scheduledMessages.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{formatScheduleWhen(item.scheduledFor)}</strong>
                  <span>{item.body}</span>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void cancelScheduled(item.id)}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scheduleOpen && !editingMessage ? (
        <div className="schedule-composer">
          <label>
            Send later
            <input
              type="datetime-local"
              value={scheduleAt}
              min={toDatetimeLocalValue(new Date(Date.now() + 60_000))}
              onChange={(event) => setScheduleAt(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={!composer.trim() || scheduleBusy}
            onClick={() => void scheduleSend()}
          >
            {scheduleBusy ? 'Scheduling…' : 'Schedule'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setScheduleOpen(false)}
          >
            Close
          </button>
        </div>
      ) : null}

      <form
        className={`composer${editingMessage ? ' edit-mode' : ''}${
          voicePhase !== 'idle' ? ' voice-mode' : ''
        }`}
        onSubmit={(event) => {
          if (voicePhase !== 'idle') {
            event.preventDefault();
            return;
          }
          void send(event);
        }}
      >
        {voicePhase === 'recording' ? (
          <div className="voice-recorder" role="status" aria-live="polite">
            <button
              type="button"
              className="voice-recorder-btn discard"
              aria-label="Discard recording"
              title="Discard"
              onClick={discardVoice}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path
                  d="M5 7h14M10 7V5h4v2m-6 3v8m4-8v8M7 7l1 12h8l1-12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="voice-recorder-main">
              <span className="voice-recorder-dot" aria-hidden="true" />
              <span className="voice-recorder-timer">
                {formatRecordingClock(recordingMs)}
              </span>
              <div className="voice-recorder-wave" aria-hidden="true">
                {Array.from({ length: 28 }, (_, index) => (
                  <span
                    key={index}
                    style={{ animationDelay: `${(index % 8) * 0.08}s` }}
                  />
                ))}
              </div>
            </div>
            <button
              type="button"
              className="voice-recorder-btn stop"
              aria-label="Stop recording"
              title="Stop"
              onClick={stopVoiceRecording}
            >
              <span className="voice-recorder-stop-icon" />
            </button>
          </div>
        ) : voicePhase === 'preview' ? (
          <div className="voice-recorder preview" role="group" aria-label="Voice note preview">
            <button
              type="button"
              className="voice-recorder-btn discard"
              aria-label="Discard voice note"
              title="Discard"
              onClick={discardVoice}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path
                  d="M5 7h14M10 7V5h4v2m-6 3v8m4-8v8M7 7l1 12h8l1-12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              className="voice-recorder-btn play"
              aria-label={previewPlaying ? 'Pause preview' : 'Play preview'}
              title={previewPlaying ? 'Pause' : 'Play'}
              onClick={togglePreviewPlayback}
            >
              {previewPlaying ? '❚❚' : '▶'}
            </button>
            {previewUrl ? (
              <audio
                ref={previewAudioRef}
                src={previewUrl}
                preload="metadata"
                onEnded={() => setPreviewPlaying(false)}
                onPause={() => setPreviewPlaying(false)}
              />
            ) : null}
            <div className="voice-recorder-main">
              <div className="voice-recorder-wave static" aria-hidden="true">
                {Array.from({ length: 28 }, (_, index) => (
                  <span
                    key={index}
                    style={{
                      height: `${10 + ((index * 7) % 14)}px`,
                    }}
                  />
                ))}
              </div>
              <span className="voice-recorder-timer">
                {formatRecordingClock(recordingMs)}
              </span>
            </div>
            <button
              type="button"
              className="voice-recorder-btn restart"
              aria-label="Record again"
              title="Record again"
              onClick={() => void restartVoiceRecording()}
            >
              ↻
            </button>
            <button
              type="button"
              className="btn voice-recorder-send"
              aria-label="Send voice note"
              title="Send"
              disabled={uploading || !previewFile}
              onClick={() => void sendVoicePreview()}
            >
              {uploading ? '…' : 'Send'}
            </button>
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadAndSend(file, 'image');
                }
              }}
            />
            <input
              ref={docInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.rtf,.zip,.rar,.odt,.ods,.odp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/json,application/zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadAndSend(file, 'file');
                }
              }}
            />
            <div className="composer-shell">
              {!editingMessage ? (
                <div className="composer-attach-wrap" ref={attachMenuRef}>
                  <button
                    className={`composer-attach${attachMenuOpen ? ' open' : ''}`}
                    type="button"
                    aria-label="Attach"
                    title="Attach"
                    aria-expanded={attachMenuOpen}
                    disabled={uploading}
                    onClick={() => setAttachMenuOpen((open) => !open)}
                  >
                    {uploading ? (
                      <span className="composer-attach-busy">…</span>
                    ) : (
                      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                        <path
                          d="M14.5 5.5 7.8 12.2a3.2 3.2 0 1 0 4.5 4.5l7.2-7.2a4.8 4.8 0 0 0-6.8-6.8L5.5 10a1.2 1.2 0 0 0 1.7 1.7l7.2-7.2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                  {attachMenuOpen ? (
                    <div className="composer-attach-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAttachMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                      >
                        Photo
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAttachMenuOpen(false);
                          docInputRef.current?.click();
                        }}
                      >
                        Document
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <input
                ref={composerInputRef}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onFocus={() => void sendTyping(true)}
                onBlur={() => void sendTyping(false)}
                placeholder={
                  editingMessage
                    ? 'Edit message'
                    : replyTo
                      ? 'Type a reply'
                      : 'Type a message'
                }
                autoComplete="off"
              />
              {!editingMessage && !composer.trim() ? (
                <button
                  className="composer-voice"
                  type="button"
                  aria-label="Record voice note"
                  title="Record voice note"
                  disabled={uploading}
                  onClick={() => void startVoiceRecording()}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"
                    />
                  </svg>
                </button>
              ) : (
                <>
                  {!editingMessage ? (
                    <button
                      className={`composer-schedule${scheduleOpen ? ' active' : ''}`}
                      type="button"
                      aria-label="Schedule message"
                      title="Schedule message"
                      aria-pressed={scheduleOpen}
                      disabled={!composer.trim()}
                      onClick={() => {
                        setScheduleAt(defaultScheduleLocalValue());
                        setScheduleOpen((open) => !open);
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 11h4v-2h-3V7h-2z"
                        />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    className="composer-send"
                    type="submit"
                    aria-label={editingMessage ? 'Save edit' : 'Send message'}
                    title={editingMessage ? 'Save' : 'Send'}
                    disabled={editingMessage ? !composer.trim() : !composer.trim()}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </form>

      <Modal
        open={mediaOpen}
        title="Media"
        size="lg"
        onClose={() => setMediaOpen(false)}
      >
        <div className="media-gallery">
          <div className="media-gallery-tabs" role="tablist" aria-label="Media type">
            {(
              [
                ['all', 'All'],
                ['image', 'Images'],
                ['file', 'Files'],
                ['audio', 'Voice'],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={mediaKind === kind}
                className={mediaKind === kind ? 'active' : ''}
                onClick={() => {
                  if (mediaKind === kind) {
                    return;
                  }
                  setMediaKind(kind);
                  setMediaItems([]);
                  setMediaPage(1);
                  setMediaHasMore(false);
                  void loadMedia(1, kind, false);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {mediaBusy && mediaItems.length === 0 ? (
            <p className="muted">Loading media…</p>
          ) : mediaItems.length === 0 ? (
            <p className="muted">No media in this chat yet.</p>
          ) : (
            <ul className="media-gallery-list">
              {mediaItems.map((item) => {
                const kind = mediaKindOf(item);
                const attachment = item.attachment!;
                return (
                  <li key={item.id} className={`media-gallery-item kind-${kind}`}>
                    <button
                      type="button"
                      className="media-gallery-preview"
                      onClick={() => {
                        setMediaOpen(false);
                        jumpToMessage(item.id);
                      }}
                      title="Show in chat"
                    >
                      {kind === 'image' ? (
                        <img
                          src={resolveMediaUrl(attachment.url)}
                          alt={attachment.name || 'Image'}
                          loading="lazy"
                        />
                      ) : (
                        <span className="media-gallery-icon" aria-hidden="true">
                          {kind === 'audio'
                            ? '♪'
                            : fileExtLabel(attachment.name, attachment.mime)}
                        </span>
                      )}
                    </button>
                    <div className="media-gallery-meta">
                      <strong>
                        {kind === 'image'
                          ? attachment.name || 'Photo'
                          : kind === 'audio'
                            ? 'Voice note'
                            : attachment.name || 'File'}
                      </strong>
                      <small>
                        {[
                          kind === 'image'
                            ? 'Image'
                            : kind === 'audio'
                              ? 'Voice'
                              : 'File',
                          formatFileSize(attachment.size),
                          clock(item.createdAt),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="ghost media-gallery-download"
                      disabled={mediaDownloadingId === item.id}
                      onClick={() => void handleOpenMedia(item)}
                    >
                      {mediaDownloadingId === item.id ? '…' : 'Open'}
                    </button>
                    <button
                      type="button"
                      className="ghost media-gallery-download"
                      disabled={mediaDownloadingId === item.id}
                      onClick={() => void handleDownloadMedia(item)}
                    >
                      {mediaDownloadingId === item.id ? '…' : 'Download'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {mediaHasMore ? (
            <button
              className="ghost full"
              type="button"
              disabled={mediaBusy}
              onClick={() => void loadMedia(mediaPage + 1, mediaKind, true)}
            >
              {mediaBusy ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(forwardMessage)}
        title="Forward message"
        size="lg"
        onClose={() => setForwardMessage(null)}
      >
        <p className="muted modal-lead">Choose a conversation to forward into.</p>
        {forwardTargets.length === 0 ? (
          <p className="muted">No other conversations available.</p>
        ) : (
          <ul className="forward-list">
            {forwardTargets.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void forwardTo(item.id)}
                >
                  {conversationTitle(item, me, byUserId)}
                  <small>{item.type === 'group' ? 'Group' : 'Direct'}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={details}
        title={conversation.type === 'group' ? 'Group details' : 'Chat info'}
        size="lg"
        onClose={() => setDetails(false)}
      >
        {conversation.type === 'private' ? (
          <>
            <p className="muted modal-lead">
              {peer
                ? formatLastSeen(peer.lastSeenAt, peer.status)
                : 'Direct message'}
            </p>
            <div className="modal-actions">
              <button className="ghost full" type="button" onClick={() => void togglePin()}>
                {conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
              </button>
              <button className="ghost full" type="button" onClick={() => void toggleMute()}>
                {conversation.muted ? 'Unmute conversation' : 'Mute conversation'}
              </button>
              <label className="disappearing-field">
                <span>Disappearing messages</span>
                <select
                  value={conversation.disappearingDurationSeconds ?? 0}
                  onChange={(event) =>
                    void setDisappearing(Number(event.target.value))
                  }
                >
                  {DISAPPEARING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="ghost full"
                type="button"
                onClick={() => {
                  setDetails(false);
                  openMedia('all');
                }}
              >
                Media (photos, files, voice)
              </button>
              <button
                className="ghost full"
                type="button"
                disabled={summaryBusy}
                onClick={() => void summarizeThread()}
              >
                {summaryBusy ? 'Summarizing…' : 'Summarize thread (AI)'}
              </button>
              <button className="danger full" type="button" onClick={() => void blockPeer()}>
                Block user
              </button>
              <button
                className="ghost full"
                type="button"
                onClick={() => {
                  setDetails(false);
                  navigate('/blocked');
                }}
              >
                Manage blocked users
              </button>
            </div>
            {summary ? <pre className="thread-summary">{summary}</pre> : null}
          </>
        ) : (
          <>
            <ul className="member-list">
              {conversation.members.map((member) => {
                const name = displayName(byUserId.get(member.userId));
                const canRemove =
                  canManage && member.userId !== me && member.role !== 'owner';
                const canChangeRole =
                  isOwner && member.userId !== me && member.role !== 'owner';
                return (
                  <li key={member.userId}>
                    <span className="member-identity">
                      <span className={member.status === 'online' ? 'dot on' : 'dot'} />
                      <span>
                        {name}
                        {member.userId === me ? ' (you)' : ''}
                        <small> · {member.role}</small>
                        <small className="member-last-seen">
                          {' '}
                          · {formatLastSeen(member.lastSeenAt, member.status)}
                        </small>
                      </span>
                    </span>
                    <span className="member-actions">
                      {canChangeRole ? (
                        member.role === 'admin' ? (
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => void setMemberRole(member.userId, 'member')}
                          >
                            Demote to member
                          </button>
                        ) : (
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => void setMemberRole(member.userId, 'admin')}
                          >
                            Promote to admin
                          </button>
                        )
                      ) : null}
                      {canRemove ? (
                        <button
                          className="danger-text"
                          type="button"
                          onClick={() => void removeMember(member.userId)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="modal-actions" style={{ marginBottom: 12 }}>
              <button className="ghost full" type="button" onClick={() => void togglePin()}>
                {conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
              </button>
              <button className="ghost full" type="button" onClick={() => void toggleMute()}>
                {conversation.muted ? 'Unmute conversation' : 'Mute conversation'}
              </button>
              {canManage ? (
                <label className="disappearing-field">
                  <span>Disappearing messages</span>
                  <select
                    value={conversation.disappearingDurationSeconds ?? 0}
                    onChange={(event) =>
                      void setDisappearing(Number(event.target.value))
                    }
                  >
                    {DISAPPEARING_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="muted pad" style={{ margin: 0 }}>
                  Disappearing messages:{' '}
                  {disappearingLabel(conversation.disappearingDurationSeconds)}
                </p>
              )}
              <button
                className="ghost full"
                type="button"
                onClick={() => {
                  setDetails(false);
                  openMedia('all');
                }}
              >
                Media (photos, files, voice)
              </button>
              <button
                className="ghost full"
                type="button"
                disabled={summaryBusy}
                onClick={() => void summarizeThread()}
              >
                {summaryBusy ? 'Summarizing…' : 'Summarize thread (AI)'}
              </button>
            </div>
            {summary ? <pre className="thread-summary">{summary}</pre> : null}
            {canManage ? (
              <>
                <form className="modal-form" onSubmit={(event) => void rename(event)}>
                  <label>
                    Group name
                    <input name="name" defaultValue={conversation.name ?? ''} required />
                  </label>
                  <button className="btn full" type="submit">
                    Save name
                  </button>
                </form>
                <div className="add-people">
                  <p className="muted">Add people</p>
                  <PeoplePicker
                    people={people}
                    mode="single"
                    exclude={memberIds}
                    onPick={(person) => void addMember(person.userId)}
                  />
                </div>
              </>
            ) : null}
            <div className="modal-actions">
              <button className="danger full" type="button" onClick={() => void leave()}>
                Leave group
              </button>
              {isCreator ? (
                <button className="danger full" type="button" onClick={() => void deleteGroup()}>
                  Delete group
                </button>
              ) : null}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
