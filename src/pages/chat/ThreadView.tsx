import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { getAccessToken, getSession } from '../../auth/session';
import { useAuth } from '../../auth/AuthContext';
import { useChatSocket } from '../../chat/ChatSocketContext';
import { useVoiceCall } from '../../calls/VoiceCallContext';
import { HuddleIcon } from '../../components/HuddleIcon';
import { Modal } from '../../components/Modal';
import { MrkdwnEditor } from '../../components/MrkdwnEditor';
import { useConfirm } from '../../components/ConfirmProvider';
import { MessageTicks } from '../../components/MessageTicks';
import { UserAvatar } from '../../components/UserAvatar';
import { UserHoverCard } from '../../components/UserHoverCard';
import {
  resolveMediaUrl,
  VoiceNotePlayer,
} from '../../components/VoiceNotePlayer';
import { useWorkspace } from '../../theme/WorkspaceContext';
import {
  clock,
  conversationTitle,
  displayName,
  formatLastSeen,
  formatScheduleWhen,
  initials,
  otherMember,
} from '../../lib/format';
import {
  callHistoryLabel,
  parseCallHistoryBody,
} from '../../calls/types';
import {
  extractMentionIds,
  extractSlackMentionIds,
  firstUrl,
  isPlaceholderBody,
  parseMentionQuery,
  prefixComposerLines,
  renderMessageBody,
  wrapComposerSelection,
  type FormatMarker,
} from '../../lib/chatComposer';
import {
  clearMessageDraft,
  getMessageDraft,
  loadMessageDraft,
  setMessageDraft,
} from '../../lib/messageDrafts';
import { downloadMedia, openMedia as openAttachmentMedia } from '../../lib/downloadMedia';
import {
  loadChannelNotificationMode,
  saveChannelNotificationMode,
  type ChannelNotifyMode,
} from '../../lib/notifications';
import { useDirectory } from '../../people/useDirectory';
import type {
  ChatMessage,
  Conversation,
  LinkPreview,
  MessageBookmark,
  MessageEditHistory,
  MessageReminder,
  Paginated,
  ScheduledMessage,
  SeenResult,
  UserGroup,
} from '../../api/types';
import type { MessengerOutletContext } from './MessengerPage';
import { ChannelTabs, type ChannelTab } from './ChannelTabs';
import { FilesPanel, type MediaKindTab } from './tabs/FilesPanel';

const DELETE_FOR_EVERYONE_MS = Number.POSITIVE_INFINITY;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Slack-style: same author within 5 minutes → continuation (no avatar/name). */
function isMessageContinuation(
  previous: ChatMessage | undefined,
  current: ChatMessage,
): boolean {
  if (!previous) return false;
  if (previous.type === 'call' || current.type === 'call') return false;
  if (previous.deletedForEveryone || current.deletedForEveryone) return false;
  if (current.replyTo) return false;
  const prevBot = previous.botUsername?.trim() || null;
  const currBot = current.botUsername?.trim() || null;
  if (Boolean(prevBot) !== Boolean(currBot)) return false;
  if (prevBot && currBot && prevBot !== currBot) return false;
  if (!prevBot && previous.senderId !== current.senderId) return false;
  const prevAt = new Date(previous.createdAt).getTime();
  const currAt = new Date(current.createdAt).getTime();
  if (!Number.isFinite(prevAt) || !Number.isFinite(currAt)) return false;
  return currAt - prevAt < GROUP_WINDOW_MS;
}

function sameCalendarDay(a: string, b: string): boolean {
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function dayDividerLabel(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const diffDays = Math.round(
    (startToday.getTime() - startThen.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return then.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
const MORE_REACTIONS = [
  '🎉',
  '🔥',
  '👀',
  '✅',
  '❌',
  '💯',
  '🙌',
  '👏',
  '🤝',
  '💪',
  '🤔',
  '😅',
  '🥲',
  '😭',
  '😡',
  '🤯',
  '🥳',
  '😎',
  '🤩',
  '😴',
  '🫡',
  '🫶',
  '✨',
  '⭐',
  '🚀',
  '📌',
  '💡',
  '⚠️',
  '🧠',
  '☕',
] as const;

type VoicePhase = 'idle' | 'recording' | 'preview';

function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleLocalValue() {
  return toDatetimeLocalValue(new Date(Date.now() + 5 * 60 * 1000));
}

function mediaKindOf(message: ChatMessage): 'image' | 'file' | 'audio' | 'video' {
  const mime = message.attachment?.mime ?? '';
  const name = message.attachment?.name ?? '';
  if (
    mime.startsWith('video/') ||
    /^clip-video-/i.test(name)
  ) {
    return 'video';
  }
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
  if (kind === 'video') {
    return 'clip.webm';
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
    poll: message.poll ?? null,
    editedAt: message.editedAt ?? null,
    pinned: Boolean(message.pinned),
    pinnedAt: message.pinnedAt ?? null,
    pinnedByUserId: message.pinnedByUserId ?? null,
    forwarded: Boolean(message.forwarded),
    undelivered: Boolean(message.undelivered),
    expiresAt: message.expiresAt ?? null,
    threadRootId: message.threadRootId ?? null,
    replyCount: message.replyCount ?? 0,
    translatedText: message.translatedText ?? null,
    showOriginal: Boolean(message.showOriginal),
    // Bot / webhook / legacy WS payloads may omit seenBy — never leave it undefined.
    seenBy: Array.isArray(message.seenBy) ? message.seenBy : [],
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

function MsgMenuIcon({ path }: { path: string }) {
  return (
    <svg className="msg-menu-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d={path} />
    </svg>
  );
}

const MSG_MENU_ICONS = {
  react:
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 14.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0-4c-.83 0-1.5-.67-1.5-1.5S9.67 9.5 10.5 9.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3 4c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0-4c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  reply:
    'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  thread:
    'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z',
  translate:
    'M12.87 15.07l-2.54-2.51.03-.03A17.5 17.5 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z',
  edit:
    'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  forward:
    'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
  pin:
    'M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z',
  save:
    'M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z',
  remind:
    'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  unread:
    'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
  delete:
    'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
} as const;

function disappearingLabel(seconds: number | undefined) {
  const match = DISAPPEARING_OPTIONS.find((item) => item.value === (seconds ?? 0));
  return match?.label ?? 'Off';
}

function MentionedText({
  body,
  mentionLabels,
  userGroupHandles,
  selfId,
  messageId,
}: {
  body: string;
  mentionLabels: Map<string, string>;
  userGroupHandles?: Set<string>;
  selfId?: string;
  messageId: string;
}) {
  const parts = renderMessageBody(body, mentionLabels, userGroupHandles);
  return (
    <>
      {parts.map((part, index) => {
        const key = `${messageId}-p-${index}`;
        if (part.type === 'mention') {
          const isYou =
            Boolean(selfId) &&
            (part.userId === selfId ||
              part.special === 'channel' ||
              part.special === 'here' ||
              part.special === 'usergroup');
          const label =
            part.special === 'channel'
              ? '@channel'
              : part.special === 'here'
                ? '@here'
                : part.special === 'usergroup'
                  ? `@${part.groupHandle ?? part.value}`
                  : part.value;
          return (
            <mark
              key={key}
              className={`wa-mention${isYou ? ' wa-mention-you' : ''}${
                part.special ? ` wa-mention-${part.special}` : ''
              }`}
            >
              {label}
            </mark>
          );
        }
        if (part.type === 'bold') {
          return <strong key={key}>{part.value}</strong>;
        }
        if (part.type === 'italic') {
          return <em key={key}>{part.value}</em>;
        }
        if (part.type === 'strike') {
          return <s key={key}>{part.value}</s>;
        }
        if (part.type === 'code') {
          return (
            <code key={key} className="wa-msg-code">
              {part.value}
            </code>
          );
        }
        if (part.type === 'link') {
          return (
            <a
              key={key}
              className="wa-msg-link"
              href={part.href || part.value}
              target="_blank"
              rel="noreferrer"
            >
              {part.value}
            </a>
          );
        }
        return <span key={key}>{part.value}</span>;
      })}
    </>
  );
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
  if (message.type === 'poll') {
    return body || 'Poll';
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
  const session = getSession();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/chat/uploads');
    xhr.setRequestHeader('ngrok-skip-browser-warning', 'true');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    if (session?.activeOrganizationId) {
      xhr.setRequestHeader('X-Organization-Id', session.activeOrganizationId);
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
  const threadParam = searchParams.get('thread');
  const tabParam = searchParams.get('tab');
  const { session } = useAuth();
  const me = session?.user.id;
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const workspace = useWorkspace();
  const { clearUnread, setUnread, refreshInbox, conversations, laterItems, refreshLater } =
    useOutletContext<MessengerOutletContext>();
  const { byUserId, ensureProfiles } = useDirectory();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState('');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [slashNotice, setSlashNotice] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState('');
  const [askResult, setAskResult] = useState<{
    answer: string;
    poweredByAi: boolean;
    citations: Array<{
      messageId: string;
      conversationId: string;
      conversationName: string | null;
      bodySnippet: string;
    }>;
  } | null>(null);
  const askInputRef = useRef<HTMLInputElement | null>(null);
  const [slashCommands, setSlashCommands] = useState<
    Array<{ name: string; description: string; builtin?: boolean }>
  >([]);
  const [slashHighlight, setSlashHighlight] = useState(0);
  const [topicDetailsOpen, setTopicDetailsOpen] = useState(false);
  const [userGroups, setUserGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState('');
  const [smartReplies, setSmartReplies] = useState<string[]>([]);
  const [smartRepliesAi, setSmartRepliesAi] = useState(false);
  const [smartRepliesBusy, setSmartRepliesBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [menuMessageId, setMenuMessageId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{
    top: number;
    left: number;
    placeAbove: boolean;
  } | null>(null);
  const [remindMenuOpen, setRemindMenuOpen] = useState(false);
  const [remindCustomOpen, setRemindCustomOpen] = useState(false);
  const [remindCustomAt, setRemindCustomAt] = useState(() =>
    toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [reminderToast, setReminderToast] = useState<string | null>(null);
  const [reactPickerId, setReactPickerId] = useState<string | null>(null);
  const [reactPickerAnchor, setReactPickerAnchor] = useState<{
    top: number;
    left: number;
    alignEnd: boolean;
  } | null>(null);
  const [reactPickerExpanded, setReactPickerExpanded] = useState(false);
  const [reactPickerQuery, setReactPickerQuery] = useState('');
  const [editHistory, setEditHistory] = useState<MessageEditHistory | null>(null);
  const [editHistoryBusy, setEditHistoryBusy] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<ChatMessage | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [mentionJumpId, setMentionJumpId] = useState<string | null>(null);
  const [unreadDividerId, setUnreadDividerId] = useState<string | null>(null);
  const [catchUpSince, setCatchUpSince] = useState<string | null>(null);
  const [catchUpUnreadCount, setCatchUpUnreadCount] = useState(0);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [catchUpBusy, setCatchUpBusy] = useState(false);
  const [catchUpSummary, setCatchUpSummary] = useState('');
  const [catchUpPoweredByAi, setCatchUpPoweredByAi] = useState(false);
  const [catchUpFirstUnreadId, setCatchUpFirstUnreadId] = useState<
    string | null
  >(null);
  const [catchUpError, setCatchUpError] = useState('');
  const [channelNotifyMode, setChannelNotifyMode] =
    useState<ChannelNotifyMode>('default');
  const [notifyMenuOpen, setNotifyMenuOpen] = useState(false);
  const [channelNotifyBusy, setChannelNotifyBusy] = useState(false);
  const [mentionBannerDismissed, setMentionBannerDismissed] = useState(false);
  const [filesInitialKind, setFilesInitialKind] = useState<MediaKindTab>('all');
  const [dmFilesOpen, setDmFilesOpen] = useState(false);
  const [mediaDownloadingId, setMediaDownloadingId] = useState<string | null>(null);
  const [channelTab, setChannelTab] = useState<ChannelTab>('messages');
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const notifyMenuRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);
  const [pollBusy, setPollBusy] = useState(false);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const remindersByMessageId = useMemo(() => {
    const next: Record<string, MessageReminder> = {};
    for (const item of laterItems) {
      if (item.conversationId !== id || item.status !== 'pending') {
        continue;
      }
      const existing = next[item.messageId];
      if (
        !existing ||
        new Date(item.remindAt).getTime() < new Date(existing.remindAt).getTime()
      ) {
        next[item.messageId] = item;
      }
    }
    return next;
  }, [laterItems, id]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<MessageBookmark[]>([]);
  const [savedBusy, setSavedBusy] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleLocalValue);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [formatToolbarOpen, setFormatToolbarOpen] = useState(true);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const [pendingLinkPreview, setPendingLinkPreview] = useState<LinkPreview | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [recordingMs, setRecordingMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [activeThreadRoot, setActiveThreadRoot] = useState<ChatMessage | null>(null);
  const [threadReplies, setThreadReplies] = useState<ChatMessage[]>([]);
  const [threadComposer, setThreadComposer] = useState('');
  const [threadBusy, setThreadBusy] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [alsoSendToChannel, setAlsoSendToChannel] = useState(false);
  const [translateBusyId, setTranslateBusyId] = useState<string | null>(null);
  const activeThreadRootRef = useRef<ChatMessage | null>(null);
  activeThreadRootRef.current = activeThreadRoot;
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
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
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
  /** When true, skip auto-mark-seen so Slack-style "Mark unread" can stick until leave. */
  const holdAutoSeenRef = useRef(false);
  const { joinConversation, leaveConversation, subscribe, emit } = useChatSocket();
  const {
    phase: callPhase,
    startCall,
    startHuddle,
    joinCall,
    refreshLobby,
    lobbiesByConversation,
  } = useVoiceCall();
  const ongoingLobby = lobbiesByConversation[id];
  const ongoingIsHuddle = ongoingLobby?.mode === 'huddle';
  const canJoinOngoing =
    (conversation?.type === 'group' || conversation?.type === 'private') &&
    callPhase === 'idle' &&
    Boolean(ongoingLobby?.active) &&
    Boolean(ongoingLobby?.joinedIds.length) &&
    !ongoingLobby?.joinedIds.includes(me || '');
  const inThisHuddle =
    Boolean(ongoingIsHuddle) &&
    Boolean(ongoingLobby?.active) &&
    Boolean(me && ongoingLobby?.joinedIds.includes(me)) &&
    callPhase !== 'idle';

  const myMemberRole = conversation?.members.find((member) => member.userId === me)?.role;
  const canManageChannel =
    myMemberRole === 'owner' || myMemberRole === 'admin';
  const announceOnlyLocked = Boolean(
    conversation?.announceOnly && !canManageChannel,
  );
  const channelTopic = conversation?.topic?.trim() || '';
  const channelDescription = conversation?.description?.trim() || '';
  const showTopicBanner = Boolean(
    conversation?.type === 'group' &&
      (channelTopic ||
        channelDescription ||
        conversation?.announceOnly ||
        canManageChannel),
  );

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
  const peerOnline = peer ? peer.status !== 'offline' : false;
  const groupOnlineCount =
    conversation?.type === 'group'
      ? conversation.members.filter(
          (member) => member.status !== 'offline' && member.userId !== me,
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
          ? `${groupOnlineCount} active`
          : 'no one online';
      return `${onlineBit} · ${conversation.members.length} members`;
    }
    if (!peer) {
      return 'Offline';
    }
    return formatLastSeen(peer.lastSeenAt, peer.status, peer.customStatus);
  }, [conversation, typing, groupOnlineCount, peer]);
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

  const userGroupHandles = useMemo(
    () => new Set(userGroups.map((group) => group.handle.toLowerCase())),
    [userGroups],
  );

  /** Members + any loaded profiles — so `<@uuid>` bot mentions resolve to names. */
  const mentionRenderLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const [userId, profile] of byUserId) {
      map.set(userId, displayName(profile));
    }
    if (conversation?.type === 'group') {
      for (const member of conversation.members) {
        if (!map.has(member.userId)) {
          map.set(member.userId, displayName(byUserId.get(member.userId)));
        }
      }
    }
    return map;
  }, [conversation, byUserId]);

  useEffect(() => {
    const ids = new Set<string>();
    for (const message of messages) {
      for (const mentionId of message.mentions ?? []) {
        ids.add(mentionId);
      }
      for (const mentionId of extractSlackMentionIds(message.body ?? '')) {
        ids.add(mentionId);
      }
    }
    if (ids.size) {
      void ensureProfiles([...ids]);
    }
  }, [messages, ensureProfiles]);

  const memberByUserId = useMemo(() => {
    const map = new Map(
      (conversation?.members ?? []).map((member) => [member.userId, member]),
    );
    return map;
  }, [conversation?.members]);

  const mentionQuery = parseMentionQuery(composer);
  const slashQuery = useMemo(() => {
    if (editingMessage) return null;
    const match = composer.match(/^\/([a-zA-Z0-9_]*)$/);
    if (!match) return null;
    return match[1].toLowerCase();
  }, [composer, editingMessage]);

  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === null) return [];
    const q = slashQuery;
    return slashCommands
      .filter(
        (item) =>
          !q ||
          item.name.startsWith(q) ||
          item.description.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [slashCommands, slashQuery]);

  useEffect(() => {
    setSlashHighlight(0);
  }, [slashQuery, filteredSlashCommands.length]);

  useEffect(() => {
    function onComposerSlash(event: Event) {
      const detail = (event as CustomEvent<{ command?: string }>).detail;
      const command = detail?.command?.trim();
      if (!command) return;
      insertSlashCommand(command);
    }
    window.addEventListener('relay:composer-slash', onComposerSlash);
    return () =>
      window.removeEventListener('relay:composer-slash', onComposerSlash);
  }, []);

  const filteredMentions = mentionQuery
    ? [
        ...(['channel', 'here'] as const)
          .filter((token) => token.startsWith(mentionQuery.query))
          .map((token) => ({
            userId: `__${token}`,
            label: token,
            special: token as 'channel' | 'here' | 'usergroup',
            hint:
              token === 'channel'
                ? 'notify everyone'
                : 'notify people online',
          })),
        ...userGroups
          .filter(
            (group) =>
              group.handle.startsWith(mentionQuery.query) ||
              group.name.toLowerCase().includes(mentionQuery.query),
          )
          .map((group) => ({
            userId: `__group:${group.id}`,
            label: group.handle,
            special: 'usergroup' as const,
            hint: group.name,
          })),
        ...mentionCandidates
          .filter((member) =>
            member.label.toLowerCase().includes(mentionQuery.query),
          )
          .map((member) => ({
            ...member,
            special: undefined as undefined,
            hint: undefined as string | undefined,
          })),
      ]
    : [];

  const threadMentionQuery = parseMentionQuery(threadComposer);

  useEffect(() => {
    if (!activeThreadRoot) {
      setThreadComposer('');
      setAlsoSendToChannel(false);
      return;
    }
    setThreadComposer('');
    setAlsoSendToChannel(false);
  }, [activeThreadRoot?.id]);

  const filteredThreadMentions = threadMentionQuery
    ? [
        ...(['channel', 'here'] as const)
          .filter((token) => token.startsWith(threadMentionQuery.query))
          .map((token) => ({
            userId: `__${token}`,
            label: token,
            special: token as 'channel' | 'here' | 'usergroup',
            hint:
              token === 'channel'
                ? 'notify everyone'
                : 'notify people online',
          })),
        ...userGroups
          .filter(
            (group) =>
              group.handle.startsWith(threadMentionQuery.query) ||
              group.name.toLowerCase().includes(threadMentionQuery.query),
          )
          .map((group) => ({
            userId: `__group:${group.id}`,
            label: group.handle,
            special: 'usergroup' as const,
            hint: group.name,
          })),
        ...mentionCandidates
          .filter((member) =>
            member.label.toLowerCase().includes(threadMentionQuery.query),
          )
          .map((member) => ({
            ...member,
            special: undefined as undefined,
            hint: undefined as string | undefined,
          })),
      ]
    : [];

  async function loadHistory(page = 1, prepend = false) {
    const history = await api<Paginated<ChatMessage>>(
      `/chat/conversations/${id}/messages?page=${page}&limit=80`,
    );
    const batch = [...history.data.items]
      .reverse()
      .map(normalizeMessage)
      .filter((item) => !item.threadRootId);
    setMessages((current) => (prepend ? [...batch, ...current] : batch));
    setHasOlder(history.data.meta.hasNextPage);
    setMessagePage(page);
    return batch;
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
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [id, scheduledMessages.length]);

  async function load() {
    setLoading(true);
    setConversation(null);
    setMessages([]);
    setPinnedMessages([]);
    setMentionJumpId(null);
    setUnreadDividerId(null);
    setMentionBannerDismissed(false);
    setNotifyMenuOpen(false);
    setChannelNotifyMode('default');
    setScheduledMessages([]);
    setScheduleOpen(false);
    setFormatToolbarOpen(false);
    setPollOpen(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollAllowMultiple(false);
    setBookmarkedIds(new Set());
    setSavedOpen(false);
    setSavedItems([]);
    const conv = await api<Conversation>(`/chat/conversations/${id}`);
    const historyBatch = await loadHistory(1, false);
    void loadPinned();
    void loadScheduled();
    setConversation({
      ...conv.data,
      muted: Boolean(conv.data.muted),
      pinned: Boolean(conv.data.pinned),
      blockedByMe: Boolean(conv.data.blockedByMe),
      blockedMe: Boolean(conv.data.blockedMe),
      hasUnreadMention: Boolean(conv.data.hasUnreadMention),
      firstUnreadMentionMessageId:
        conv.data.firstUnreadMentionMessageId ?? null,
    });
    const inboxRow = conversations.find((item) => item.id === id);
    const mentionJumpTarget =
      conv.data.firstUnreadMentionMessageId ??
      inboxRow?.firstUnreadMentionMessageId ??
      null;
    setMentionJumpId(mentionJumpTarget);
    setMentionBannerDismissed(false);
    setLoading(false);

    // Capture unread "New" divider before we mark the channel read.
    const unreadCount = Math.max(
      0,
      inboxRow?.unreadCount ?? conv.data.unreadCount ?? 0,
    );
    const myMembership = conv.data.members.find((member) => member.userId === me);
    const lastReadMs = myMembership?.lastReadAt
      ? new Date(myMembership.lastReadAt).getTime()
      : NaN;
    setCatchUpSince(myMembership?.lastReadAt ?? conv.data.lastReadAt ?? null);
    setCatchUpUnreadCount(unreadCount);
    setCatchUpSummary('');
    setCatchUpError('');
    setCatchUpOpen(false);
    setCatchUpFirstUnreadId(null);
    const channelMessages = historyBatch.filter(
      (item) => !item.threadRootId && item.type !== 'call',
    );
    let dividerId: string | null = null;
    if (unreadCount > 0) {
      if (Number.isFinite(lastReadMs)) {
        const firstUnread = channelMessages.find(
          (item) =>
            item.senderId !== me &&
            new Date(item.createdAt).getTime() > lastReadMs,
        );
        dividerId = firstUnread?.id ?? null;
      }
      if (!dividerId) {
        const fromEnd = channelMessages.slice(-unreadCount);
        dividerId = fromEnd.find((item) => item.senderId !== me)?.id ?? null;
      }
    }
    setUnreadDividerId(dividerId);
    if (dividerId) {
      setCatchUpFirstUnreadId(dividerId);
    }

    void loadChannelNotificationMode(id).then(setChannelNotifyMode);

    if (!holdAutoSeenRef.current) {
      clearUnread(id);
    }
    void ensureProfiles(
      conv.data.members.map((member) => member.userId),
      { refresh: true },
    );
    if (conv.data.type === 'group') {
      void refreshLobby(id);
    }
    void api<Paginated<UserGroup>>('/chat/user-groups?page=1&limit=100')
      .then((response) => setUserGroups(response.data.items ?? []))
      .catch(() => setUserGroups([]));
    void api<
      Paginated<{ name: string; description: string; builtin?: boolean }>
    >('/chat/slash-commands?page=1&limit=100')
      .then((response) => setSlashCommands(response.data.items ?? []))
      .catch(() =>
        setSlashCommands([
          { name: 'ai', description: 'Ask Relay about this channel (/ai …)', builtin: true },
          { name: 'remind', description: 'Remind yourself (/remind 1h …)', builtin: true },
          { name: 'poll', description: 'Create a poll', builtin: true },
          { name: 'assign', description: 'Assign a list task', builtin: true },
          { name: 'status', description: 'Set your status', builtin: true },
          { name: 'help', description: 'List slash commands', builtin: true },
        ]),
      );
    void loadBookmarks();
    if (holdAutoSeenRef.current) {
      return;
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

  async function loadBookmarks() {
    try {
      const response = await api<Paginated<MessageBookmark>>(
        `/chat/bookmarks?page=1&limit=100&conversationId=${encodeURIComponent(id)}`,
      );
      setBookmarkedIds(
        new Set((response.data.items ?? []).map((item) => item.messageId)),
      );
    } catch {
      setBookmarkedIds(new Set());
    }
  }

  async function loadSavedMessages() {
    setSavedBusy(true);
    try {
      const response = await api<Paginated<MessageBookmark>>(
        '/chat/bookmarks?page=1&limit=50',
      );
      setSavedItems(
        (response.data.items ?? []).map((item) => ({
          ...item,
          message: normalizeMessage(item.message),
        })),
      );
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not load saved messages',
      );
    } finally {
      setSavedBusy(false);
    }
  }

  async function toggleBookmark(message: ChatMessage) {
    const isSaved = bookmarkedIds.has(message.id);
    closeMessageOverlays();
    try {
      if (isSaved) {
        await api(`/chat/bookmarks/${message.id}`, { method: 'DELETE' });
        setBookmarkedIds((current) => {
          const next = new Set(current);
          next.delete(message.id);
          return next;
        });
        setSavedItems((current) =>
          current.filter((item) => item.messageId !== message.id),
        );
      } else {
        const response = await api<MessageBookmark>('/chat/bookmarks', {
          method: 'POST',
          body: JSON.stringify({ messageId: message.id }),
        });
        setBookmarkedIds((current) => new Set(current).add(message.id));
        setSavedItems((current) => [
          {
            ...response.data,
            message: normalizeMessage(response.data.message),
          },
          ...current.filter((item) => item.messageId !== message.id),
        ]);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not update saved message',
      );
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
    holdAutoSeenRef.current = false;
    setError('');
    setActionError('');
    setComposer('');
    setAskOpen(false);
    setAskQuestion('');
    setAskResult(null);
    setAskError('');
    setAskBusy(false);
    setRemindMenuOpen(false);
    setRemindCustomOpen(false);
    setReminderToast(null);
    void loadMessageDraft(id).then((draft) => {
      setComposer(draft);
    });
    setTyping('');
    setReplyTo(null);
    setEditingMessage(null);
    setMenuMessageId(null);
    setMenuAnchor(null);
    setReactPickerId(null);
    setReactPickerAnchor(null);
    setForwardMessage(null);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setPinnedMessages([]);
    setFilesInitialKind('all');
    setDmFilesOpen(false);
    setMediaDownloadingId(null);
    setChannelTab('messages');
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
        if (normalized.threadRootId) {
          const openRoot = activeThreadRootRef.current;
          const openMatches =
            Boolean(openRoot) && openRoot!.id === normalized.threadRootId;

          if (openMatches) {
            setThreadReplies((current) => {
              const exists = current.some((item) => item.id === normalized.id);
              if (!exists) {
                queueMicrotask(() => {
                  setMessages((msgs) =>
                    msgs.map((item) =>
                      item.id === normalized.threadRootId
                        ? {
                            ...item,
                            replyCount: (item.replyCount ?? 0) + 1,
                          }
                        : item,
                    ),
                  );
                  setActiveThreadRoot((root) =>
                    root && root.id === normalized.threadRootId
                      ? { ...root, replyCount: (root.replyCount ?? 0) + 1 }
                      : root,
                  );
                });
              }
              return upsertMessage(current, normalized);
            });
          } else {
            setMessages((msgs) =>
              msgs.map((item) =>
                item.id === normalized.threadRootId
                  ? {
                      ...item,
                      replyCount: (item.replyCount ?? 0) + 1,
                    }
                  : item,
              ),
            );
          }
          clearUnread(id);
          if (holdAutoSeenRef.current) {
            return;
          }
          void api(`/chat/conversations/${id}/seen`, {
            method: 'POST',
            body: JSON.stringify({}),
          })
            .then(() => clearUnread(id))
            .catch(() => clearUnread(id));
          return;
        }
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
        // Standup / daily-meeting prompts: open the thread panel so replies collect like Slack.
        // Skip summaries (those are already threaded under the prompt).
        if (
          normalized.botUsername?.trim() &&
          !normalized.threadRootId &&
          !activeThreadRootRef.current &&
          /stand-?up|daily meeting|check-in/i.test(normalized.botUsername) &&
          /reply in this thread/i.test(normalized.body || '')
        ) {
          queueMicrotask(() => {
            setActiveThreadRoot(normalized);
            void loadThreadReplies(normalized.id);
          });
        }
        // Scheduled delivery lands as a normal message — refresh pending list.
        if (scheduledMessagesRef.current.length > 0) {
          void loadScheduled();
        }
        if (holdAutoSeenRef.current) {
          return;
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
          status: 'online' | 'away' | 'busy' | 'dnd' | 'offline';
          lastSeenAt?: string | null;
          customStatus?: string | null;
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
            const seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
            if (seenBy.includes(event.userId)) {
              return message;
            }
            const readAt = new Date(event.lastReadAt).getTime();
            const createdAt = new Date(message.createdAt).getTime();
            if (Number.isFinite(readAt) && createdAt > readAt) {
              return message;
            }
            return {
              ...message,
              seenBy: [...seenBy, event.userId],
            };
          }),
        );
      }),
      subscribe('chat:unseen', (payload) => {
        const event = payload as SeenResult;
        if (event.conversationId !== id || !event.userId) {
          return;
        }
        const readAt = new Date(event.lastReadAt).getTime();
        setMessages((current) =>
          current.map((message) => {
            const seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
            if (!seenBy.includes(event.userId)) {
              return message;
            }
            const createdAt = new Date(message.createdAt).getTime();
            // Cursor rewound before this message → drop their read receipt.
            if (Number.isFinite(readAt) && createdAt > readAt) {
              return {
                ...message,
                seenBy: seenBy.filter((userId) => userId !== event.userId),
              };
            }
            return message;
          }),
        );
        setConversation((current) => {
          if (!current) return current;
          return {
            ...current,
            members: current.members.map((member) =>
              member.userId === event.userId
                ? { ...member, lastReadAt: event.lastReadAt }
                : member,
            ),
          };
        });
      }),
      subscribe('chat:group_deleted', (payload) => {
        const event = payload as { conversationId: string };
        if (event.conversationId === id) {
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
          navigate('/chat');
        }
      }),
      subscribe('chat:reminder', (payload) => {
        const event = payload as {
          conversationId?: string;
          bodySnippet?: string;
          messageId?: string;
        };
        const snippet = (event.bodySnippet || 'Message reminder').slice(0, 80);
        setReminderToast(`Reminder: ${snippet}`);
        window.setTimeout(() => setReminderToast(null), 8000);
        if (event.conversationId && event.messageId) {
          if (event.conversationId === id) {
            jumpToMessage(event.messageId);
          } else {
            navigate(
              `/chat/${event.conversationId}?focus=${event.messageId}`,
            );
          }
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
    if (!notifyMenuOpen) {
      return;
    }
    const onPointerDown = (event: Event) => {
      const root = notifyMenuRef.current;
      if (root && !root.contains(event.target as Node)) {
        setNotifyMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNotifyMenuOpen(false);
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
  }, [notifyMenuOpen]);

  useEffect(() => {
    if (!menuMessageId && !reactPickerId) {
      return;
    }
    const closeOverlays = () => {
      setMenuMessageId(null);
      setMenuAnchor(null);
      setReactPickerId(null);
      setReactPickerAnchor(null);
      setReactPickerExpanded(false);
      setReactPickerQuery('');
      setRemindMenuOpen(false);
      setRemindCustomOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOverlays();
      }
    };
    const isInsideOverlay = (event: Event) => {
      const node = event.target;
      if (!(node instanceof Element)) {
        return false;
      }
      return Boolean(
        node.closest('.msg-menu') ||
          node.closest('.msg-menu-btn') ||
          node.closest('.msg-react-picker') ||
          node.closest('.reaction-picker'),
      );
    };
    const onPointerDown = (event: Event) => {
      if (isInsideOverlay(event)) {
        return;
      }
      closeOverlays();
    };
    const onScrollOrWheel = (event: Event) => {
      // Allow scrolling inside the menu / reaction picker; only dismiss when the thread moves.
      if (isInsideOverlay(event)) {
        return;
      }
      closeOverlays();
    };

    // Defer so the same tap that opened the menu (and mobile ghost clicks) don't instantly close it.
    const attachTimer = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('scroll', onScrollOrWheel, true);
      document.addEventListener('wheel', onScrollOrWheel, {
        passive: true,
        capture: true,
      });
    }, 320);

    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', closeOverlays);
    return () => {
      window.clearTimeout(attachTimer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScrollOrWheel, true);
      document.removeEventListener('wheel', onScrollOrWheel, true);
      window.removeEventListener('resize', closeOverlays);
    };
  }, [menuMessageId, reactPickerId]);

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
    }, 600);
    return () => window.clearTimeout(handle);
  }, [composer, editingMessage, id]);

  const latestIncomingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (
        message &&
        me &&
        message.senderId !== me &&
        !message.deletedForEveryone &&
        message.body?.trim()
      ) {
        return message.id;
      }
    }
    return null;
  }, [messages, me]);

  useEffect(() => {
    const composerLocked =
      Boolean(conversation?.blockedMe) ||
      Boolean(conversation?.blockedByMe) ||
      announceOnlyLocked;
    if (!id || !latestIncomingId || editingMessage || composerLocked) {
      setSmartReplies([]);
      setSmartRepliesAi(false);
      return;
    }
    let cancelled = false;
    setSmartRepliesBusy(true);
    const timer = window.setTimeout(() => {
      void api<{ replies: string[]; poweredByAi: boolean }>(
        `/chat/conversations/${id}/smart-replies`,
      )
        .then((response) => {
          if (cancelled) return;
          setSmartReplies(response.data.replies ?? []);
          setSmartRepliesAi(Boolean(response.data.poweredByAi));
        })
        .catch(() => {
          if (!cancelled) {
            setSmartReplies([]);
            setSmartRepliesAi(false);
          }
        })
        .finally(() => {
          if (!cancelled) setSmartRepliesBusy(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    id,
    latestIncomingId,
    editingMessage,
    announceOnlyLocked,
    conversation?.blockedMe,
    conversation?.blockedByMe,
  ]);

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

    if (/^\/[a-zA-Z]/.test(body)) {
      setSlashNotice('');
      let raw = body;

      // Channel-scoped Ask Relay — open the simple Ask panel.
      if (/^\/ai\b/i.test(raw)) {
        const question = raw.replace(/^\/ai\b/i, '').trim();
        setComposer('');
        clearMessageDraft(id);
        openChannelAsk(question);
        if (question.length >= 3) {
          void runChannelAsk(question);
        }
        return;
      }

      if (/^\/assign\b/i.test(raw)) {
        for (const member of mentionCandidates) {
          if (member.userId.startsWith('__')) continue;
          const handle = member.label.replace(/\s+/g, '');
          if (!handle) continue;
          raw = raw.replace(
            new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
            `<@${member.userId}>`,
          );
        }
      }
      try {
        const response = await api<{
          kind: 'message' | 'ephemeral' | 'status';
          message?: ChatMessage;
          ephemeral?: string | null;
          customStatus?: string | null;
        }>(`/chat/conversations/${id}/slash`, {
          method: 'POST',
          body: JSON.stringify({ raw }),
        });
        if (response.data.kind === 'message' && response.data.message) {
          setMessages((current) =>
            upsertMessage(current, normalizeMessage(response.data.message!)),
          );
        }
        if (response.data.ephemeral) {
          setSlashNotice(response.data.ephemeral);
        } else if (response.data.kind === 'status' && response.data.customStatus) {
          setSlashNotice(`Status set to “${response.data.customStatus}”`);
        } else if (response.data.kind === 'status') {
          setSlashNotice('Status cleared');
        }
        if (/^\/remind\b/i.test(raw)) {
          void refreshLater();
        }
        setComposer('');
        clearMessageDraft(id);
        setReplyTo(null);
        setPendingLinkPreview(null);
        void sendTyping(false);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : 'Could not run slash command',
        );
      }
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
    try {
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
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not send message');
    }
  }

  async function createPoll() {
    const question = pollQuestion.trim();
    const options = pollOptions.map((item) => item.trim()).filter(Boolean);
    if (question.length < 2 || options.length < 2 || pollBusy) {
      return;
    }
    setPollBusy(true);
    setActionError('');
    try {
      const response = await api<ChatMessage>(`/chat/conversations/${id}/polls`, {
        method: 'POST',
        body: JSON.stringify({
          question,
          options,
          allowMultiple: pollAllowMultiple,
        }),
      });
      setMessages((current) => upsertMessage(current, normalizeMessage(response.data)));
      setPollOpen(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollAllowMultiple(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not create poll');
    } finally {
      setPollBusy(false);
    }
  }

  async function votePoll(messageId: string, optionId: string) {
    try {
      const response = await api<ChatMessage>(
        `/chat/conversations/${id}/messages/${messageId}/poll-votes`,
        {
          method: 'POST',
          body: JSON.stringify({ optionId }),
        },
      );
      setMessages((current) => upsertMessage(current, normalizeMessage(response.data)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not record vote');
    }
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


  function openFilesPage(kind: MediaKindTab = 'all') {
    setToolsMenuOpen(false);
    setSearchOpen(false);
    setFilesInitialKind(kind);
    if (conversation?.type === 'group') {
      setDmFilesOpen(false);
      setChannelTab('files');
      return;
    }
    setDmFilesOpen(true);
  }

  useEffect(() => {
    const mediaParam = searchParams.get('media');
    if (!mediaParam || loading || !conversation) {
      return;
    }
    const kind: MediaKindTab =
      mediaParam === 'image' || mediaParam === 'file' || mediaParam === 'audio'
        ? mediaParam
        : 'all';
    openFilesPage(kind);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('media');
        return next;
      },
      { replace: true },
    );
    // Intentionally only when media query appears after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, conversation?.id]);

  useEffect(() => {
    if (!tabParam || loading || !conversation) {
      return;
    }
    const allowed: ChannelTab[] = [
      'messages',
      'files',
      'pins',
      'canvas',
      'lists',
      'clips',
      'workflows',
      'apps',
      'connect',
    ];
    if (!allowed.includes(tabParam as ChannelTab)) {
      return;
    }
    if (tabParam === 'connect' && conversation.type !== 'group') {
      return;
    }
    setChannelTab(tabParam as ChannelTab);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('tab');
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam, loading, conversation?.id]);

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

  function insertMention(
    label: string,
    special?: 'channel' | 'here' | 'usergroup',
  ) {
    if (mentionQuery === null) {
      return;
    }
    const handle =
      special === 'usergroup' || special === 'channel' || special === 'here'
        ? special === 'usergroup'
          ? label
          : special
        : label.replace(/\s+/g, '');
    const next = `${composer.slice(0, mentionQuery.start)}@${handle} `;
    setComposer(next);
  }

  function insertThreadMention(
    label: string,
    special?: 'channel' | 'here' | 'usergroup',
  ) {
    if (threadMentionQuery === null) {
      return;
    }
    const handle =
      special === 'usergroup' || special === 'channel' || special === 'here'
        ? special === 'usergroup'
          ? label
          : special
        : label.replace(/\s+/g, '');
    const next = `${threadComposer.slice(0, threadMentionQuery.start)}@${handle} `;
    setThreadComposer(next);
  }

  function applyComposerFormat(marker: FormatMarker, placeholder?: string) {
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? composer.length;
    const end = input?.selectionEnd ?? composer.length;
    const next = wrapComposerSelection(
      composer,
      start,
      end,
      marker,
      placeholder,
    );
    setComposer(next.value);
    window.requestAnimationFrame(() => {
      const el = composerInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  function applyComposerPrefix(prefix: string) {
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? composer.length;
    const end = input?.selectionEnd ?? composer.length;
    const next = prefixComposerLines(composer, start, end, prefix);
    setComposer(next.value);
    window.requestAnimationFrame(() => {
      const el = composerInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  function insertComposerSnippet(snippet: string) {
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? composer.length;
    const end = input?.selectionEnd ?? composer.length;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    const nextValue = `${composer.slice(0, from)}${snippet}${composer.slice(to)}`;
    const caret = from + snippet.length;
    setComposer(nextValue);
    setComposerEmojiOpen(false);
    window.requestAnimationFrame(() => {
      const el = composerInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function insertComposerLink() {
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? composer.length;
    const end = input?.selectionEnd ?? composer.length;
    const selected = composer.slice(start, end).trim();
    const url = window.prompt(
      'Link URL',
      selected.startsWith('http') ? selected : 'https://',
    );
    if (!url?.trim()) return;
    const href = url.trim();
    if (selected && !selected.startsWith('http')) {
      const value = `${composer.slice(0, start)}${selected} (${href})${composer.slice(end)}`;
      setComposer(value);
      return;
    }
    insertComposerSnippet(href);
  }

  async function runChannelAsk(questionRaw?: string) {
    const question = (questionRaw ?? askQuestion).trim();
    if (question.length < 3 || askBusy) return;
    setAskBusy(true);
    setAskError('');
    setAskResult(null);
    setSlashNotice('');
    try {
      const response = await api<{
        answer: string;
        poweredByAi: boolean;
        citations: Array<{
          messageId: string;
          conversationId: string;
          conversationName: string | null;
          bodySnippet: string;
        }>;
      }>('/chat/ask', {
        method: 'POST',
        body: JSON.stringify({ question, conversationId: id }),
      });
      setAskResult(response.data);
      setAskOpen(true);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Ask Relay failed');
      setAskOpen(true);
    } finally {
      setAskBusy(false);
    }
  }

  function openChannelAsk(seed = '') {
    setAskOpen(true);
    setAskError('');
    if (seed.trim()) setAskQuestion(seed.trim());
    window.setTimeout(() => askInputRef.current?.focus(), 40);
  }

  function insertSlashCommand(name: string) {
    if (name === 'ai') {
      setComposer('');
      openChannelAsk();
      return;
    }
    if (name === 'assign') {
      setComposer('/assign ');
    } else if (name === 'remind') {
      setComposer('/remind 1h ');
    } else if (name === 'poll') {
      setComposer('/poll ');
    } else if (name === 'status') {
      setComposer('/status ');
    } else {
      setComposer(`/${name} `);
    }
    window.setTimeout(() => composerInputRef.current?.focus(), 20);
  }

  function onComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (filteredSlashCommands.length > 0 && slashQuery !== null) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashHighlight(
          (index) => (index + 1) % filteredSlashCommands.length,
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashHighlight(
          (index) =>
            (index - 1 + filteredSlashCommands.length) %
            filteredSlashCommands.length,
        );
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const pick =
          filteredSlashCommands[
            Math.min(slashHighlight, filteredSlashCommands.length - 1)
          ];
        if (pick) insertSlashCommand(pick.name);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setComposer('');
        return;
      }
    }

    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Enter' && !event.shiftKey && !mod) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }
    if (!mod) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      applyComposerFormat('*', 'bold');
      return;
    }
    if (key === 'i') {
      event.preventDefault();
      applyComposerFormat('_', 'italic');
      return;
    }
    if (key === 'e' && event.shiftKey) {
      event.preventDefault();
      applyComposerFormat('`', 'code');
      return;
    }
    if (key === 'x' && event.shiftKey) {
      event.preventDefault();
      applyComposerFormat('~', 'strike');
    }
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
    closeMessageOverlays();
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
    closeMessageOverlays();
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

  async function applyChannelNotifyMode(mode: ChannelNotifyMode) {
    if (!conversation || !id) return;
    setChannelNotifyBusy(true);
    setActionError('');
    try {
      const saved = await saveChannelNotificationMode(id, mode);
      setChannelNotifyMode(saved);
      // Keep mute flag aligned with "Nothing" for inbox quiet styling.
      if (mode === 'none' && !conversation.muted) {
        const response = await api<Conversation>(`/chat/conversations/${id}/mute`, {
          method: 'POST',
          body: JSON.stringify({ muted: true }),
        });
        setConversation(response.data);
        void refreshInbox();
      } else if (mode !== 'none' && conversation.muted) {
        const response = await api<Conversation>(`/chat/conversations/${id}/mute`, {
          method: 'POST',
          body: JSON.stringify({ muted: false }),
        });
        setConversation(response.data);
        void refreshInbox();
      }
      setNotifyMenuOpen(false);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not update notifications',
      );
    } finally {
      setChannelNotifyBusy(false);
    }
  }

  const channelNotifyLabel =
    conversation?.muted || channelNotifyMode === 'none'
      ? 'Muted'
      : channelNotifyMode === 'mentions'
        ? 'Mentions'
        : channelNotifyMode === 'all'
          ? 'All msgs'
          : null;

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

  async function unblockPeer() {
    if (!peer) {
      return;
    }
    const label = displayName(byUserId.get(peer.userId));
    const ok = await confirmDialog({
      title: 'Unblock user',
      message: `Unblock ${label}? They will be able to message you again.`,
      confirmLabel: 'Unblock',
      cancelLabel: 'Cancel',
    });
    if (!ok) {
      return;
    }
    try {
      await api(`/chat/blocks/${peer.userId}`, { method: 'DELETE' });
      setConversation((current) =>
        current ? { ...current, blockedByMe: false } : current,
      );
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not unblock user');
    }
  }

  async function deleteMessage(message: ChatMessage, forEveryone: boolean) {
    closeMessageOverlays();
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

  function jumpToMessage(messageId: string) {
    setHighlightId(messageId);
    const el = messageRefs.current.get(messageId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setHighlightId(null), 1600);
  }

  async function runCatchMeUp() {
    if (!id || catchUpBusy) return;
    setCatchUpOpen(true);
    setCatchUpBusy(true);
    setCatchUpError('');
    try {
      const response = await api<{
        summary: string;
        poweredByAi: boolean;
        messageCount: number;
        firstUnreadMessageId: string | null;
        since: string | null;
      }>(`/chat/conversations/${id}/catch-up`, {
        method: 'POST',
        body: JSON.stringify({ since: catchUpSince }),
      });
      setCatchUpSummary(response.data.summary);
      setCatchUpPoweredByAi(Boolean(response.data.poweredByAi));
      if (response.data.firstUnreadMessageId) {
        setCatchUpFirstUnreadId(response.data.firstUnreadMessageId);
      }
      if (response.data.messageCount > 0) {
        setCatchUpUnreadCount(response.data.messageCount);
      }
    } catch (err) {
      setCatchUpError(
        err instanceof Error ? err.message : 'Could not catch you up',
      );
    } finally {
      setCatchUpBusy(false);
    }
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

  useEffect(() => {
    if (!threadParam || loading || !id || activeThreadRoot?.id === threadParam) {
      return;
    }
    let cancelled = false;

    const clearThreadParam = () => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('thread');
          return next;
        },
        { replace: true },
      );
    };

    async function openThreadFromParam() {
      try {
        const local = messagesRef.current.find(
          (item) => item.id === threadParam && !item.threadRootId,
        );
        let root = local ?? null;
        if (!root) {
          const response = await api<ChatMessage>(
            `/chat/conversations/${id}/messages/${threadParam}`,
          );
          root = normalizeMessage(response.data);
          if (root.threadRootId) {
            const parent = await api<ChatMessage>(
              `/chat/conversations/${id}/messages/${root.threadRootId}`,
            );
            root = normalizeMessage(parent.data);
          }
        }
        if (cancelled || !root || root.threadRootId) {
          return;
        }
        setActiveThreadRoot(root);
        await loadThreadReplies(root.id);
      } catch {
        // Ignore — thread may have been deleted
      } finally {
        if (!cancelled) {
          clearThreadParam();
        }
      }
    }

    void openThreadFromParam();
    return () => {
      cancelled = true;
    };
  }, [threadParam, loading, id, activeThreadRoot?.id, setSearchParams]);

  function startReply(message: ChatMessage) {
    if (message.deletedForEveryone || isPendingMessage(message)) {
      return;
    }
    setReplyTo(message);
    setEditingMessage(null);
    closeMessageOverlays();
    window.setTimeout(() => composerInputRef.current?.focus(), 50);
  }

  async function loadThreadReplies(threadRootId: string) {
    if (!id) return;
    setThreadLoading(true);
    try {
      const response = await api<Paginated<ChatMessage>>(
        `/chat/conversations/${id}/messages/thread/${threadRootId}?page=1&limit=50`,
      );
      const items = response.data.items.map(normalizeMessage);
      setThreadReplies(items);
      setActiveThreadRoot((current) =>
        current && current.id === threadRootId
          ? {
              ...current,
              replyCount: response.data.meta.total || current.replyCount || items.length,
            }
          : current,
      );
      await ensureProfiles([
        ...items.map((item) => item.senderId),
      ]);
      try {
        // Slack auto-follows when you open a thread.
        await api(`/chat/conversations/${id}/threads/${threadRootId}/follow`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        await api(`/chat/conversations/${id}/threads/${threadRootId}/read`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      } catch {
        // Non-fatal
      }
    } catch {
      setThreadReplies([]);
    } finally {
      setThreadLoading(false);
    }
  }

  async function unfollowActiveThread() {
    if (!id || !activeThreadRoot) return;
    try {
      await api(
        `/chat/conversations/${id}/threads/${activeThreadRoot.id}/follow`,
        { method: 'DELETE' },
      );
      setActionError('');
      closeThreadPanel();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not unfollow thread',
      );
    }
  }

  async function sendThreadReply(event?: FormEvent) {
    event?.preventDefault();
    if (!id || !activeThreadRoot || announceOnlyLocked) {
      return;
    }
    const body = threadComposer.trim();
    if (!body) {
      return;
    }
    const mentionUserIds = extractMentionIds(body, mentionCandidates);
    setThreadBusy(true);
    setActionError('');
    try {
      const payload: {
        body: string;
        type: string;
        threadRootId: string;
        mentionUserIds?: string[];
        alsoSendToChannel?: boolean;
      } = {
        body,
        type: 'text',
        threadRootId: activeThreadRoot.id,
        mentionUserIds,
        alsoSendToChannel: alsoSendToChannel || undefined,
      };
      const response = await api<ChatMessage>(
        `/chat/conversations/${id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
      const normalized = normalizeMessage(response.data);
      setThreadReplies((current) => upsertMessage(current, normalized));
      setThreadComposer('');
      setMessages((current) =>
        current.map((item) =>
          item.id === activeThreadRoot.id
            ? { ...item, replyCount: (item.replyCount ?? 0) + 1 }
            : item,
        ),
      );
      setActiveThreadRoot((root) =>
        root ? { ...root, replyCount: (root.replyCount ?? 0) + 1 } : root,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not send reply');
    } finally {
      setThreadBusy(false);
    }
  }

  async function translateMessage(message: ChatMessage) {
    if (!id || message.deletedForEveryone) return;
    closeMessageOverlays();
    setTranslateBusyId(message.id);
    setActionError('');
    try {
      const response = await api<{
        translatedText: string;
        poweredByAi: boolean;
      }>(`/chat/conversations/${id}/messages/${message.id}/translate`, {
        method: 'POST',
        body: JSON.stringify({ targetLanguage: 'en' }),
      });
      const translatedText = response.data.translatedText || '';
      const patch = (item: ChatMessage) =>
        item.id === message.id
          ? { ...item, translatedText, showOriginal: false }
          : item;
      setMessages((current) => current.map(patch));
      setThreadReplies((current) => current.map(patch));
      setActiveThreadRoot((root) => (root ? patch(root) : root));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      setTranslateBusyId(null);
    }
  }

  function toggleShowOriginal(message: ChatMessage) {
    const patch = (item: ChatMessage) =>
      item.id === message.id
        ? { ...item, showOriginal: !item.showOriginal }
        : item;
    setMessages((current) => current.map(patch));
    setThreadReplies((current) => current.map(patch));
    setActiveThreadRoot((root) => (root ? patch(root) : root));
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

  function closeMessageOverlays() {
    setMenuMessageId(null);
    setMenuAnchor(null);
    setReactPickerId(null);
    setReactPickerAnchor(null);
    setReactPickerExpanded(false);
    setReactPickerQuery('');
    setRemindMenuOpen(false);
    setRemindCustomOpen(false);
  }

  function openReactPicker(messageId: string, alignEnd: boolean) {
    const row = messageRefs.current.get(messageId);
    const bubble =
      (row?.querySelector('.wa-bubble') as HTMLElement | null) ?? row ?? null;
    if (!bubble) {
      return;
    }
    const rect = bubble.getBoundingClientRect();
    // Use expanded width so opening "+" doesn't push the panel off-screen.
    const pickerWidth = Math.min(280, window.innerWidth - 24);
    const edge = 12;
    const gap = 8;
    let left = alignEnd ? rect.right - pickerWidth : rect.left;
    left = Math.max(edge, Math.min(left, window.innerWidth - pickerWidth - edge));
    const top = rect.bottom + gap;
    setMenuMessageId(null);
    setMenuAnchor(null);
    setRemindMenuOpen(false);
    setRemindCustomOpen(false);
    setReactPickerExpanded(false);
    setReactPickerQuery('');
    setReactPickerAnchor({ top, left, alignEnd });
    setReactPickerId(messageId);
  }

  function clampReactPickerInViewport() {
    setReactPickerAnchor((current) => {
      if (!current) {
        return current;
      }
      const pickerWidth = Math.min(280, window.innerWidth - 24);
      const edge = 12;
      const left = Math.max(
        edge,
        Math.min(current.left, window.innerWidth - pickerWidth - edge),
      );
      if (left === current.left) {
        return current;
      }
      return { ...current, left };
    });
  }

  function reminderAtInOneHour(): string {
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }

  function reminderAtTomorrow9am(): string {
    const when = new Date();
    when.setDate(when.getDate() + 1);
    when.setHours(9, 0, 0, 0);
    if (when.getTime() < Date.now() + 60_000) {
      when.setDate(when.getDate() + 1);
    }
    return when.toISOString();
  }

  function reminderAtIn3Days(): string {
    return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  }

  async function createMessageReminder(message: ChatMessage, remindAt: string) {
    try {
      await api<MessageReminder>(
        `/chat/conversations/${id}/messages/${message.id}/remind`,
        {
          method: 'POST',
          body: JSON.stringify({ remindAt }),
        },
      );
      await refreshLater();
      setActionError('');
      setReminderToast(`Reminder set for ${formatScheduleWhen(remindAt)}`);
      window.setTimeout(() => setReminderToast(null), 4000);
      closeMessageOverlays();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not set reminder',
      );
    }
  }

  async function cancelMessageReminder(message: ChatMessage) {
    const existing = remindersByMessageId[message.id];
    if (!existing) {
      return;
    }
    try {
      await api(`/chat/reminders/${existing.id}`, { method: 'DELETE' });
      await refreshLater();
      setActionError('');
      setReminderToast('Reminder cancelled');
      window.setTimeout(() => setReminderToast(null), 3000);
      closeMessageOverlays();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not cancel reminder',
      );
    }
  }

  async function createCustomMessageReminder(message: ChatMessage) {
    const when = new Date(remindCustomAt);
    if (Number.isNaN(when.getTime())) {
      setActionError('Pick a valid date and time');
      return;
    }
    await createMessageReminder(message, when.toISOString());
  }

  async function createIssueFromMessage(
    message: ChatMessage,
    appKey: 'github' | 'jira',
  ) {
    if (!id) return;
    try {
      const result = await api<{
        externalUrl: string;
        title: string;
        message?: ChatMessage;
      }>(`/chat/conversations/${id}/apps/${appKey}/issues`, {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id }),
      });
      if (result.data.message) {
        setMessages((current) => {
          if (current.some((item) => item.id === result.data.message!.id)) {
            return current;
          }
          return [...current, result.data.message!];
        });
      }
      setReminderToast(`Created ${result.data.title}`);
      window.setTimeout(() => setReminderToast(null), 4000);
      setActionError('');
      closeMessageOverlays();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : `Could not create ${appKey} issue. Connect the app in the Apps tab first.`,
      );
    }
  }

  async function markMessageUnread(message: ChatMessage) {
    if (message.deletedForEveryone) {
      return;
    }
    try {
      await api(`/chat/conversations/${id}/unread`, {
        method: 'POST',
        body: JSON.stringify({ messageId: message.id }),
      });
      const unreadFromOthers = messagesRef.current.filter((item) => {
        if (item.deletedForEveryone) return false;
        if (me && item.senderId === me) return false;
        return item.createdAt >= message.createdAt;
      }).length;
      holdAutoSeenRef.current = true;
      setUnread(id, Math.max(1, unreadFromOthers), {
        firstUnreadMessageId: message.id,
      });
      setReminderToast('Marked as unread');
      window.setTimeout(() => setReminderToast(null), 3000);
      setActionError('');
      closeMessageOverlays();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not mark as unread',
      );
    }
  }

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      const action = detail?.action;
      if (action === 'focus-composer') {
        composerInputRef.current?.focus();
        return;
      }
      if (action === 'mark-unread') {
        const list = messagesRef.current.filter(
          (item) => !item.deletedForEveryone,
        );
        if (list.length === 0) return;
        const lastOther = [...list]
          .reverse()
          .find((item) => !me || item.senderId !== me);
        const target = lastOther ?? list[list.length - 1];
        if (target) {
          void markMessageUnread(target);
        }
      }
    };
    window.addEventListener('relay:command', onCommand);
    return () => window.removeEventListener('relay:command', onCommand);
  }, [me]);

  function positionMessageMenu(anchor: HTMLElement, alignEnd: boolean) {
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 220;
    const gap = 8;
    let left = alignEnd ? rect.right - menuWidth : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    // Always open below the message / anchor (same as reaction picker).
    const top = rect.bottom + gap;
    setMenuAnchor({ top, left, placeAbove: false });
  }

  function toggleMessageMenu(
    messageId: string,
    anchor: HTMLElement,
    alignEnd: boolean,
  ) {
    if (menuMessageId === messageId) {
      closeMessageOverlays();
      return;
    }
    setReactPickerId(null);
    setReactPickerAnchor(null);
    setRemindMenuOpen(false);
    setRemindCustomOpen(false);
    positionMessageMenu(anchor, alignEnd);
    setMenuMessageId(messageId);
  }

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
      isPendingMessage(message) ||
      message.type === 'poll' ||
      message.type === 'call'
    ) {
      return false;
    }
    return Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;
  }

  function startEdit(message: ChatMessage) {
    setEditingMessage(message);
    setComposer(message.body && !isPlaceholderBody(message.body) ? message.body : '');
    setReplyTo(null);
    closeMessageOverlays();
  }

  function closeThreadPanel() {
    setActiveThreadRoot(null);
    setThreadReplies([]);
    setThreadComposer('');
    setAlsoSendToChannel(false);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('thread');
        return next;
      },
      { replace: true },
    );
  }

  function openThreadPanel(message: ChatMessage) {
    setActiveThreadRoot(message);
    closeMessageOverlays();
    void loadThreadReplies(message.id);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('thread', message.id);
        return next;
      },
      { replace: true },
    );
  }

  async function openEditHistory(message: ChatMessage) {
    if (!id || !message.editedAt) {
      return;
    }
    setEditHistoryBusy(true);
    setActionError('');
    try {
      const response = await api<MessageEditHistory>(
        `/chat/conversations/${id}/messages/${message.id}/edits`,
      );
      setEditHistory(response.data);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not load edit history',
      );
    } finally {
      setEditHistoryBusy(false);
    }
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
    <div
      className={`thread${activeThreadRoot ? ' has-side-thread' : ''}`}
    >
      <div className="thread-stage">
      <header className="thread-head">
        <div className="thread-head-main">
          <button
            className="ghost thread-tool-btn thread-back"
            type="button"
            aria-label="Back to messages"
            title="Back to messages"
            onClick={() => navigate('/chat')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"
              />
            </svg>
          </button>
          <UserAvatar
            profile={
              conversation.type === 'private' && peer
                ? byUserId.get(peer.userId)
                : null
            }
            name={title}
            size="sm"
            className="thread-head-avatar"
          />
          <div>
            <h2>
              {conversation.pinned ? (
                <span className="pin-badge" title="Pinned" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="12" height="12">
                    <path
                      fill="currentColor"
                      d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2zm-1.5 2h-5L11 12.5V4h2v8.5l1.5 1.5z"
                    />
                  </svg>
                </span>
              ) : null}
              {title}
              {channelNotifyLabel ? (
                <span className="mute-pill">{channelNotifyLabel}</span>
              ) : null}
              {conversation.announceOnly ? (
                <span
                  className="announce-pill"
                  title="Only owners and admins can post"
                >
                  Announcement
                </span>
              ) : null}
              {conversation.isShared ? (
                <span className="connect-pill" title="Shared with external collaborators">
                  Shared
                </span>
              ) : null}
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
                  className={`ghost thread-tool-btn call join${
                    ongoingIsHuddle ? ' huddle' : ''
                  }`}
                  type="button"
                  aria-label={
                    ongoingIsHuddle ? 'Join channel huddle' : 'Join group call'
                  }
                  title={ongoingIsHuddle ? 'Join huddle' : 'Join call'}
                  onClick={() => void joinCall(conversation.id)}
                >
                  {ongoingIsHuddle ? (
                    <HuddleIcon size={18} />
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 7.7 7.7 0 0 0 2.4.4 1.2 1.2 0 0 1 1.2 1.2V20a1.2 1.2 0 0 1-1.2 1.2A17.2 17.2 0 0 1 2.8 4 1.2 1.2 0 0 1 4 2.8h3.5A1.2 1.2 0 0 1 8.7 4a7.7 7.7 0 0 0 .4 2.4 1.2 1.2 0 0 1-.3 1.2z"
                      />
                    </svg>
                  )}
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
                    disabled={callPhase !== 'idle' || Boolean(ongoingLobby?.active)}
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
                    disabled={callPhase !== 'idle' || Boolean(ongoingLobby?.active)}
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
              className={`ghost thread-tool-btn${
                channelTab === 'files' || dmFilesOpen ? ' active' : ''
              }`}
              type="button"
              aria-label="Files"
              title="Files"
              aria-pressed={channelTab === 'files' || dmFilesOpen}
              onClick={() => {
                if (conversation?.type === 'group' && channelTab === 'files') {
                  setChannelTab('messages');
                } else if (dmFilesOpen) {
                  setDmFilesOpen(false);
                } else {
                  openFilesPage('all');
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
            <div className="thread-notify-wrap" ref={notifyMenuRef}>
              <button
                className={`ghost thread-tool-btn${
                  conversation.muted ||
                  channelNotifyMode === 'mentions' ||
                  channelNotifyMode === 'none'
                    ? ' active'
                    : ''
                }${notifyMenuOpen ? ' open' : ''}`}
                type="button"
                aria-label="Notification preferences"
                aria-expanded={notifyMenuOpen}
                aria-haspopup="menu"
                title="Notifications"
                disabled={channelNotifyBusy}
                onClick={() => {
                  setToolsMenuOpen(false);
                  setNotifyMenuOpen((open) => !open);
                }}
              >
                {conversation.muted || channelNotifyMode === 'none' ? (
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
              {notifyMenuOpen ? (
                <div className="thread-notify-menu" role="menu">
                  <p className="thread-notify-menu-label">Get notified for</p>
                  {(
                    [
                      ['default', 'Workspace default'],
                      ['all', 'All messages'],
                      ['mentions', 'Mentions & keywords'],
                      ['none', 'Nothing'],
                    ] as const
                  ).map(([value, label]) => {
                    const selected =
                      value === 'none'
                        ? conversation.muted || channelNotifyMode === 'none'
                        : !conversation.muted && channelNotifyMode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={selected ? 'is-selected' : ''}
                        disabled={channelNotifyBusy}
                        onClick={() => void applyChannelNotifyMode(value)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button
              className="ghost thread-tool-btn"
              type="button"
              aria-label={conversation.type === 'group' ? 'Channel details' : 'Chat info'}
              title={conversation.type === 'group' ? 'Details' : 'Chat info'}
              onClick={() => {
                setToolsMenuOpen(false);
                setNotifyMenuOpen(false);
                navigate(`/chat/${id}/details`);
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
            onClick={() => {
              setNotifyMenuOpen(false);
              setToolsMenuOpen((open) => !open);
            }}
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
                onClick={() => {
                  setToolsMenuOpen(false);
                  void runCatchMeUp();
                }}
              >
                Catch me up
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => openFilesPage('all')}
              >
                Files
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
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
                  setSavedOpen(true);
                  void loadSavedMessages();
                }}
              >
                Saved messages
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
                  setNotifyMenuOpen(true);
                }}
              >
                Notifications…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  navigate(`/chat/${id}/details`);
                }}
              >
                {conversation.type === 'group' ? 'Channel details' : 'Chat info'}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {showTopicBanner ? (
        <div className="thread-topic-banner" role="note">
          {conversation.announceOnly ? (
            <span className="thread-topic-banner-chip">Announcement</span>
          ) : null}
          <button
            type="button"
            className="thread-topic-banner-main"
            title="View channel topic"
            onClick={() => setTopicDetailsOpen(true)}
          >
            <strong className={channelTopic ? undefined : 'is-empty'}>
              {channelTopic ||
                (canManageChannel ? 'Add a channel topic' : 'No topic set')}
            </strong>
            {channelDescription ? (
              <span className="thread-topic-banner-desc muted">
                {channelDescription}
              </span>
            ) : conversation.announceOnly ? (
              <span className="thread-topic-banner-desc muted">
                {canManageChannel
                  ? 'Only you and other admins can post here'
                  : 'Only owners and admins can post here'}
              </span>
            ) : null}
          </button>
          {canManageChannel ? (
            <button
              type="button"
              className="ghost thread-topic-banner-edit"
              onClick={() => navigate(`/chat/${id}/details`)}
            >
              Edit
            </button>
          ) : null}
        </div>
      ) : null}

      {canJoinOngoing ? (
        <button
          className={`wa-ongoing-call${ongoingIsHuddle ? ' is-huddle' : ''}`}
          type="button"
          onClick={() => void joinCall(conversation.id)}
          aria-label={
            ongoingIsHuddle
              ? 'Join channel huddle'
              : ongoingLobby?.media === 'video'
                ? 'Join ongoing group video call as voice'
                : 'Join ongoing group voice call'
          }
        >
          <span className="wa-ongoing-call-icon" aria-hidden="true">
            {ongoingIsHuddle ? (
              <HuddleIcon size={18} />
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 7.7 7.7 0 0 0 2.4.4 1.2 1.2 0 0 1 1.2 1.2V20a1.2 1.2 0 0 1-1.2 1.2A17.2 17.2 0 0 1 2.8 4 1.2 1.2 0 0 1 4 2.8h3.5A1.2 1.2 0 0 1 8.7 4a7.7 7.7 0 0 0 .4 2.4 1.2 1.2 0 0 1-.3 1.2z"
                />
              </svg>
            )}
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
              {ongoingIsHuddle
                ? 'Huddle live'
                : ongoingLobby?.media === 'video'
                  ? 'Ongoing video call'
                  : 'Ongoing voice call'}
            </strong>
            <span>
              {ongoingLobby?.joinedIds.length ?? 0}{' '}
              {(ongoingLobby?.joinedIds.length ?? 0) === 1
                ? 'person'
                : 'people'}
              {ongoingIsHuddle
                ? ' · Hop in anytime'
                : ongoingLobby?.media === 'video'
                  ? ' · Tap to join (voice)'
                  : ' · Tap to join'}
            </span>
          </span>

          <span className="wa-ongoing-call-join">
            {ongoingIsHuddle ? 'Join huddle' : 'Join'}
          </span>
        </button>
      ) : null}

      {mentionJumpId && !mentionBannerDismissed && !focusMessageId ? (
        <div className="mention-jump-banner">
          <button
            type="button"
            className="mention-jump-banner-main"
            onClick={() => {
              const targetId = mentionJumpId;
              setMentionBannerDismissed(true);
              setMentionJumpId(null);
              if (messagesRef.current.some((item) => item.id === targetId)) {
                jumpToMessage(targetId);
                return;
              }
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.set('focus', targetId);
                  return next;
                },
                { replace: true },
              );
            }}
          >
            <span className="mention-jump-icon" aria-hidden="true">
              @
            </span>
            <span className="mention-jump-copy">
              <strong>Jump to unread mention</strong>
              <small>Someone mentioned you in this chat</small>
            </span>
          </button>
          <button
            type="button"
            className="ghost mention-jump-dismiss"
            aria-label="Dismiss mention banner"
            onClick={() => {
              setMentionBannerDismissed(true);
              setMentionJumpId(null);
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {catchUpUnreadCount > 0 && unreadDividerId && !catchUpOpen ? (
        <div className="catch-up-banner">
          <button
            type="button"
            className="catch-up-banner-main"
            onClick={() => void runCatchMeUp()}
            disabled={catchUpBusy}
          >
            <span className="catch-up-banner-icon" aria-hidden="true">
              ✦
            </span>
            <span className="catch-up-banner-copy">
              <strong>
                {catchUpBusy ? 'Catching you up…' : 'Catch me up'}
              </strong>
              <small>
                {catchUpUnreadCount} unread · summarize what you missed
              </small>
            </span>
          </button>
          <button
            type="button"
            className="ghost catch-up-banner-dismiss"
            aria-label="Dismiss catch up banner"
            onClick={() => setCatchUpUnreadCount(0)}
          >
            ×
          </button>
        </div>
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
              setChannelTab('pins');
              setSearchOpen(false);
              setToolsMenuOpen(false);
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
              className="ghost pinned-banner-view-all"
              aria-label="Open Pins tab"
              title="View all pins"
              onClick={() => {
                setChannelTab('pins');
                setSearchOpen(false);
                setToolsMenuOpen(false);
              }}
            >
              View all
            </button>
          )}
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
            placeholder="Search — from:name has:file after:7d"
            aria-label="Search messages"
            title="Operators: from:name · has:file|image|link|audio · after:7d · before:yyyy-mm-dd"
            autoFocus
          />
          <p className="muted search-hint">
            Tip: <code>from:jane</code> <code>has:image</code>{' '}
            <code>after:7d</code>
          </p>
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
                  <span>
                    {item.attachment?.name
                      ? `${item.body || item.attachment.name}`
                      : item.body}
                  </span>
                  <time dateTime={item.createdAt}>{clock(item.createdAt)}</time>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actionError ? <p className="error pad">{actionError}</p> : null}
      {slashNotice ? (
        <p className="muted pad slash-notice" style={{ whiteSpace: 'pre-wrap' }}>
          {slashNotice}
          <button
            type="button"
            className="ghost"
            style={{ marginLeft: 8 }}
            onClick={() => setSlashNotice('')}
          >
            Dismiss
          </button>
        </p>
      ) : null}
      {reminderToast ? (
        <p className="pad" role="status" style={{ margin: 0 }}>
          {reminderToast}
        </p>
      ) : null}

      {conversation.type === 'group' ? (
        <ChannelTabs
          conversationId={conversation.id}
          conversation={conversation}
          activeTab={channelTab}
          onTabChange={(tab) => {
            setChannelTab(tab);
            setSearchOpen(false);
            setToolsMenuOpen(false);
            setDmFilesOpen(false);
            if (tab === 'files') {
              setFilesInitialKind('all');
            }
          }}
          filesInitialKind={filesInitialKind}
          onJumpToMessage={(messageId) => {
            setChannelTab('messages');
            window.setTimeout(() => jumpToMessage(messageId), 80);
          }}
          onPinsChanged={(items) => {
            setPinnedMessages(items);
          }}
        />
      ) : null}

      {conversation.type === 'private' && dmFilesOpen ? (
        <div className="channel-tab-panel is-files" role="tabpanel">
          <FilesPanel
            conversationId={conversation.id}
            initialKind={filesInitialKind}
            onJumpToMessage={(messageId) => {
              setDmFilesOpen(false);
              window.setTimeout(() => jumpToMessage(messageId), 80);
            }}
          />
        </div>
      ) : null}

      {(conversation.type !== 'group' || channelTab === 'messages') &&
      !(conversation.type === 'private' && dmFilesOpen) ? (
        <>
      {conversation.type === 'group' && (conversation.bookmarks?.length ?? 0) > 0 ? (
        <div className="channel-bookmarks-bar" aria-label="Channel bookmarks">
          {conversation.bookmarks?.map((bookmark) => (
            <a
              key={bookmark.id}
              className="channel-bookmark-chip"
              href={bookmark.url}
              target="_blank"
              rel="noreferrer"
              title={bookmark.url}
            >
              {bookmark.title}
            </a>
          ))}
        </div>
      ) : null}

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
        {messages
          .filter((message) => !message.threadRootId)
          .map((message, index, channelList) => {
          let previousNonCall: ChatMessage | undefined;
          for (let i = index - 1; i >= 0; i -= 1) {
            const candidate = channelList[i];
            if (candidate && candidate.type !== 'call') {
              previousNonCall = candidate;
              break;
            }
          }
          const showDayDivider =
            !previousNonCall ||
            !sameCalendarDay(previousNonCall.createdAt, message.createdAt);
          const showUnreadDivider = unreadDividerId === message.id;
          const immediatePrev = index > 0 ? channelList[index - 1] : undefined;
          const continuation =
            message.type !== 'call' &&
            !showDayDivider &&
            !showUnreadDivider &&
            immediatePrev?.type !== 'call' &&
            isMessageContinuation(previousNonCall, message);

          if (message.type === 'call' && !message.deletedForEveryone) {
            const history = parseCallHistoryBody(message.body);
            const label = history ? callHistoryLabel(history) : 'Call';
            const canJoinFromHistory =
              history &&
              conversation?.type === 'group' &&
              canJoinOngoing &&
              ongoingLobby?.callId === history.callId;
            return (
              <div key={message.id} className="wa-msg-block">
                {showDayDivider ? (
                  <div className="wa-day-divider" role="separator">
                    <span>{dayDividerLabel(message.createdAt)}</span>
                  </div>
                ) : null}
                {showUnreadDivider ? (
                  <div className="wa-unread-divider" role="separator" aria-label="New messages">
                    <span>New</span>
                  </div>
                ) : null}
              <div
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
              </div>
            );
          }

          const isBot = Boolean(message.botUsername?.trim());
          const mine = !isBot && message.senderId === me;
          const pending = isPendingMessage(message);
          const seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
          const seen = Boolean(
            mine && me && !pending && seenBy.some((userId) => userId !== me),
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
            mediaKindOf(message) === 'audio';
          const showVideo =
            !message.deletedForEveryone &&
            message.attachment &&
            mediaKindOf(message) === 'video';
          const showFile =
            !message.deletedForEveryone &&
            message.attachment &&
            !showImage &&
            !showAudio &&
            !showVideo &&
            (message.type === 'file' || Boolean(message.attachment.url));
          const botLabel = message.botUsername?.trim() || null;
          const showPoll =
            !message.deletedForEveryone &&
            (message.type === 'poll' || Boolean(message.poll?.question));
          const caption =
            !showPoll && message.body && !isPlaceholderBody(message.body)
              ? message.body
              : null;
          return (
            <div key={message.id} className="wa-msg-block">
              {showDayDivider ? (
                <div className="wa-day-divider" role="separator">
                  <span>{dayDividerLabel(message.createdAt)}</span>
                </div>
              ) : null}
              {showUnreadDivider ? (
                <div className="wa-unread-divider" role="separator" aria-label="New messages">
                  <span>New</span>
                </div>
              ) : null}
            <div
              className={`${mine ? 'wa-row mine' : 'wa-row theirs'}${
                isBot ? ' is-bot' : ''
              }${continuation ? ' is-continuation' : ''}${
                highlightId === message.id ? ' highlight' : ''
              }${
                !mine && me && (message.mentions ?? []).includes(me)
                  ? ' mentions-you'
                  : ''
              }${pending ? ' is-pending' : ''}${menuOpen ? ' menu-open' : ''}`}
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
                  const btn = messageRefs.current
                    .get(message.id)
                    ?.querySelector('.msg-menu-btn') as HTMLElement | null;
                  const anchor =
                    btn ?? messageRefs.current.get(message.id) ?? null;
                  if (anchor) {
                    positionMessageMenu(anchor, mine);
                    setReactPickerId(null);
                    setReactPickerAnchor(null);
                    setMenuMessageId(message.id);
                  }
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
              {continuation ? (
                <span className="wa-msg-avatar-spacer" aria-hidden="true" />
              ) : (
              <UserHoverCard
                userId={message.senderId}
                profile={isBot ? null : byUserId.get(message.senderId)}
                member={memberByUserId.get(message.senderId)}
                isBot={isBot}
              >
                <UserAvatar
                  profile={isBot ? null : byUserId.get(message.senderId)}
                  name={
                    botLabel || displayName(byUserId.get(message.senderId))
                  }
                  imageUrl={isBot ? message.botIconUrl : null}
                  size="sm"
                  className="wa-msg-avatar"
                />
              </UserHoverCard>
              )}
              <div className={`wa-msg${mine ? ' mine' : ' theirs'}`}>
              <div
                className={`${mine ? 'wa-bubble mine' : 'wa-bubble theirs'}${
                  menuOpen || reactPickerId === message.id ? ' menu-open' : ''
                }`}
                onContextMenu={(event) => {
                  if (pending) {
                    return;
                  }
                  event.preventDefault();
                  const btn = (event.currentTarget as HTMLElement).querySelector(
                    '.msg-menu-btn',
                  ) as HTMLElement | null;
                  const anchor = btn ?? (event.currentTarget as HTMLElement);
                  positionMessageMenu(anchor, mine);
                  setReactPickerId(null);
                  setReactPickerAnchor(null);
                  setMenuMessageId(message.id);
                }}
              >
                {continuation ? (
                  <time
                    className="wa-author-time wa-author-time-hover"
                    dateTime={message.createdAt}
                  >
                    {clock(message.createdAt)}
                  </time>
                ) : (
                <span className={`wa-author${isBot ? ' wa-author-bot' : ''}`}>
                  {isBot ? (
                    <>
                      {botLabel || displayName(byUserId.get(message.senderId))}
                      <span className="wa-bot-badge">APP</span>
                    </>
                  ) : (
                    <UserHoverCard
                      userId={message.senderId}
                      profile={byUserId.get(message.senderId)}
                      member={memberByUserId.get(message.senderId)}
                    >
                      <span className="wa-author-name">
                        {mine
                          ? 'You'
                          : displayName(byUserId.get(message.senderId))}
                      </span>
                    </UserHoverCard>
                  )}
                  <time className="wa-author-time" dateTime={message.createdAt}>
                    {clock(message.createdAt)}
                  </time>
                </span>
                )}
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
                          conversationId={id}
                          messageId={message.id}
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
                    {showVideo && message.attachment ? (
                      <div className="wa-media-wrap video clip-video">
                        <video
                          className="wa-clip-video"
                          src={resolveMediaUrl(message.attachment.url)}
                          controls
                          playsInline
                          preload="metadata"
                        />
                        {!pending ? (
                          <button
                            type="button"
                            className="wa-media-download"
                            aria-label="Download clip"
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
                    {showPoll && message.poll ? (
                      <div className="wa-poll">
                        <p className="wa-poll-question">{message.poll.question}</p>
                        <ul className="wa-poll-options">
                          {message.poll.options.map((option) => {
                            const total = Math.max(1, message.poll!.totalVotes);
                            const pct = Math.round(
                              (option.voteCount / total) * 100,
                            );
                            return (
                              <li key={option.id}>
                                <button
                                  type="button"
                                  className={`wa-poll-option${
                                    option.votedByMe ? ' selected' : ''
                                  }`}
                                  disabled={message.poll!.closed || pending}
                                  onClick={() =>
                                    void votePoll(message.id, option.id)
                                  }
                                >
                                  <span
                                    className="wa-poll-fill"
                                    style={{ width: `${pct}%` }}
                                    aria-hidden="true"
                                  />
                                  <span className="wa-poll-option-copy">
                                    <strong>{option.text}</strong>
                                    <small>
                                      {option.voteCount}
                                      {message.poll!.totalVotes > 0
                                        ? ` · ${pct}%`
                                        : ''}
                                    </small>
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="wa-poll-meta muted">
                          {message.poll.totalVotes} vote
                          {message.poll.totalVotes === 1 ? '' : 's'}
                          {message.poll.allowMultiple ? ' · multiple choice' : ''}
                          {message.poll.closed ? ' · closed' : ''}
                        </p>
                      </div>
                    ) : null}
                    {caption ? (
                      <p className="wa-text">
                        <MentionedText
                          body={caption}
                          mentionLabels={mentionRenderLabels}
                          userGroupHandles={userGroupHandles}
                          selfId={me}
                          messageId={message.id}
                        />
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
                    {!showImage && !showAudio && !showPoll && !caption ? (
                      <p className="wa-text">{message.body}</p>
                    ) : null}
                    {message.translatedText ? (
                      <div className="wa-translation">
                        <p className="wa-text wa-translated">
                          {message.showOriginal
                            ? message.body
                            : message.translatedText}
                        </p>
                        <button
                          type="button"
                          className="wa-translation-toggle"
                          onClick={() => toggleShowOriginal(message)}
                        >
                          {message.showOriginal ? 'Show translation' : 'Show original'}
                        </button>
                      </div>
                    ) : translateBusyId === message.id ? (
                      <p className="muted wa-translation-busy">Translating…</p>
                    ) : null}
                  </>
                )}
                <span className="wa-meta">
                  {!pending && !message.deletedForEveryone ? (
                    <span className="msg-actions" data-msg-actions={message.id}>
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
                        className={`msg-menu-btn${menuOpen ? ' open' : ''}`}
                        type="button"
                        aria-label="Message actions"
                        aria-expanded={menuOpen}
                        aria-haspopup="menu"
                        title="More"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleMessageMenu(message.id, event.currentTarget, mine);
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
                          />
                        </svg>
                      </button>
                    </span>
                  ) : pending && message.sendStatus === 'failed' ? (
                    <button
                      className="msg-retry-btn"
                      type="button"
                      onClick={() => void retryPendingMessage(message)}
                    >
                      Retry
                    </button>
                  ) : null}
                  {message.editedAt ? (
                    <button
                      type="button"
                      className="wa-edited"
                      title="View edit history"
                      disabled={editHistoryBusy}
                      onClick={() => void openEditHistory(message)}
                    >
                      edited
                    </button>
                  ) : null}
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
                      undelivered={Boolean(message.undelivered)}
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
                      <span>
                        {/^:[a-z0-9_+-]+:$/i.test(reaction.emoji)
                          ? (() => {
                              const code = reaction.emoji.slice(1, -1).toLowerCase();
                              const custom = workspace.customEmojis.find(
                                (row) => row.shortcode === code,
                              );
                              if (custom?.imageUrl) {
                                return (
                                  <img
                                    src={custom.imageUrl}
                                    alt={reaction.emoji}
                                    width={16}
                                    height={16}
                                  />
                                );
                              }
                              return custom?.emoji ?? reaction.emoji;
                            })()
                          : reaction.emoji}
                      </span>
                      <span>{reaction.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {!pending &&
              !message.deletedForEveryone &&
              ((message.replyCount ?? 0) > 0 || isBot) ? (
                <button
                  type="button"
                  className="wa-thread-replies"
                  onClick={() => openThreadPanel(message)}
                >
                  {(message.replyCount ?? 0) > 0
                    ? `${message.replyCount} ${
                        message.replyCount === 1 ? 'reply' : 'replies'
                      }`
                    : 'Reply in thread'}
                </button>
              ) : null}
              </div>
            </div>
            </div>
          );
        })}
        {typing ? <p className="typing wa-typing">{typing}</p> : null}
      </div>

      {menuMessageId && menuAnchor
        ? createPortal(
            (() => {
              const message = messages.find((item) => item.id === menuMessageId);
              if (!message) return null;
              const mine = message.senderId === me;
              return (
                  <div
                    className={`msg-menu msg-menu-fixed${
                      menuAnchor.placeAbove ? ' place-above' : ''
                    }`}
                    style={{ top: menuAnchor.top, left: menuAnchor.left }}
                    role="menu"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    {!message.deletedForEveryone ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openReactPicker(message.id, mine)}
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.react} />
                          React
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => startReply(message)}
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.reply} />
                          Reply
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openThreadPanel(message)}
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.thread} />
                          Reply in thread
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void translateMessage(message)}
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.translate} />
                          Translate
                        </button>
                        {canEdit(message) ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => startEdit(message)}
                          >
                            <MsgMenuIcon path={MSG_MENU_ICONS.edit} />
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setForwardMessage(message);
                            closeMessageOverlays();
                          }}
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.forward} />
                          Forward
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void toggleMessagePin(message)}
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.pin} />
                          {message.pinned ? 'Unpin' : 'Pin'}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void toggleBookmark(message)}
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.save} />
                          {bookmarkedIds.has(message.id) ? 'Unsave' : 'Save'}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() =>
                            void createIssueFromMessage(message, 'github')
                          }
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.forward} />
                          Create GitHub issue
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() =>
                            void createIssueFromMessage(message, 'jira')
                          }
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.forward} />
                          Create Jira issue
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void markMessageUnread(message)}
                        >
                          <MsgMenuIcon path={MSG_MENU_ICONS.unread} />
                          Mark unread
                        </button>
                        <div className="msg-menu-item-has-sub">
                          <button
                            type="button"
                            role="menuitem"
                            aria-expanded={remindMenuOpen}
                            className={remindMenuOpen ? 'is-active' : undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              setRemindCustomOpen(false);
                              setRemindMenuOpen((open) => {
                                const next = !open;
                                if (next) {
                                  void refreshLater();
                                }
                                return next;
                              });
                            }}
                          >
                            <MsgMenuIcon path={MSG_MENU_ICONS.remind} />
                            <span className="msg-menu-label">Remind me</span>
                            <span
                              className={`msg-menu-chevron${
                                remindMenuOpen ? ' is-open' : ''
                              }`}
                              aria-hidden="true"
                            >
                              ▾
                            </span>
                          </button>
                          {remindMenuOpen ? (
                            <div className="msg-remind-nested" role="group">
                              {remindersByMessageId[message.id] ? (
                                <>
                                  <div className="msg-remind-current">
                                    Reminder set for{' '}
                                    {formatScheduleWhen(
                                      remindersByMessageId[message.id].remindAt,
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="msg-remind-nested-item msg-remind-cancel"
                                    onClick={() =>
                                      void cancelMessageReminder(message)
                                    }
                                  >
                                    <span
                                      className="msg-remind-nested-dot"
                                      aria-hidden="true"
                                    />
                                    Cancel reminder
                                  </button>
                                  <div className="msg-menu-sep" role="separator" />
                                  <p className="msg-remind-reschedule-label">
                                    Reschedule
                                  </p>
                                </>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                className="msg-remind-nested-item"
                                onClick={() =>
                                  void createMessageReminder(
                                    message,
                                    reminderAtInOneHour(),
                                  )
                                }
                              >
                                <span className="msg-remind-nested-dot" aria-hidden="true" />
                                In 1 hour
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="msg-remind-nested-item"
                                onClick={() =>
                                  void createMessageReminder(
                                    message,
                                    reminderAtTomorrow9am(),
                                  )
                                }
                              >
                                <span className="msg-remind-nested-dot" aria-hidden="true" />
                                Tomorrow 9am
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="msg-remind-nested-item"
                                onClick={() =>
                                  void createMessageReminder(
                                    message,
                                    reminderAtIn3Days(),
                                  )
                                }
                              >
                                <span className="msg-remind-nested-dot" aria-hidden="true" />
                                In 3 days
                              </button>
                              {!remindCustomOpen ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="msg-remind-nested-item"
                                  onClick={() => {
                                    setRemindCustomAt(
                                      toDatetimeLocalValue(
                                        new Date(Date.now() + 60 * 60 * 1000),
                                      ),
                                    );
                                    setRemindCustomOpen(true);
                                  }}
                                >
                                  <span className="msg-remind-nested-dot" aria-hidden="true" />
                                  Pick date &amp; time…
                                </button>
                              ) : (
                                <div className="msg-remind-custom msg-remind-nested-custom">
                                  <label>
                                    Custom reminder
                                    <input
                                      type="datetime-local"
                                      value={remindCustomAt}
                                      min={toDatetimeLocalValue(
                                        new Date(Date.now() + 60_000),
                                      )}
                                      onChange={(event) =>
                                        setRemindCustomAt(event.target.value)
                                      }
                                      onClick={(event) => event.stopPropagation()}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="msg-remind-custom-set"
                                    onClick={() =>
                                      void createCustomMessageReminder(message)
                                    }
                                  >
                                    Set reminder
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                        <div className="msg-menu-sep" role="separator" />
                      </>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void deleteMessage(message, false)}
                    >
                      <MsgMenuIcon path={MSG_MENU_ICONS.delete} />
                      {mine ? 'Delete for me only' : 'Delete for me'}
                    </button>
                    {canDeleteForEveryone(message) ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="msg-menu-danger"
                        onClick={() => void deleteMessage(message, true)}
                      >
                        <MsgMenuIcon path={MSG_MENU_ICONS.delete} />
                        Delete for everyone
                      </button>
                    ) : null}
                  </div>
              );
            })(),
            document.body,
          )
        : null}

      {reactPickerId && reactPickerAnchor
        ? createPortal(
            (() => {
              const message = messages.find((item) => item.id === reactPickerId);
              if (!message) return null;
              return (
                <div
                  className={`reaction-picker reaction-picker-fixed${
                    reactPickerExpanded ? ' reaction-picker-expanded' : ''
                  }${reactPickerAnchor.alignEnd ? ' align-end' : ''}`}
                  style={{
                    top: reactPickerAnchor.top,
                    left: reactPickerAnchor.left,
                  }}
                  data-msg-actions={message.id}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="reaction-picker-quick">
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => void toggleReaction(message, emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="reaction-picker-more"
                      aria-expanded={reactPickerExpanded}
                      aria-label={
                        reactPickerExpanded
                          ? 'Hide more reactions'
                          : 'Show more reactions'
                      }
                      onClick={() => {
                        setReactPickerExpanded((open) => {
                          const next = !open;
                          if (next) {
                            // Defer so layout uses expanded width before clamping.
                            window.requestAnimationFrame(() => {
                              clampReactPickerInViewport();
                            });
                          }
                          return next;
                        });
                      }}
                    >
                      {reactPickerExpanded ? '▾' : '+'}
                    </button>
                  </div>
                  {reactPickerExpanded ? (
                    <div className="reaction-picker-panel">
                      <input
                        className="reaction-picker-search"
                        type="search"
                        value={reactPickerQuery}
                        placeholder="Search emoji"
                        aria-label="Search emoji"
                        onChange={(event) =>
                          setReactPickerQuery(event.target.value)
                        }
                      />
                      {workspace.customEmojis.length > 0 ? (
                        <div className="reaction-picker-section">
                          <p className="reaction-picker-label">Custom</p>
                          <div className="reaction-picker-grid">
                            {workspace.customEmojis
                              .filter((row) => {
                                const q = reactPickerQuery.trim().toLowerCase();
                                if (!q) {
                                  return true;
                                }
                                return (
                                  row.shortcode.includes(q) ||
                                  (row.emoji ?? '').includes(
                                    reactPickerQuery.trim(),
                                  )
                                );
                              })
                              .map((row) => (
                                <button
                                  key={row.shortcode}
                                  type="button"
                                  title={`:${row.shortcode}:`}
                                  onClick={() =>
                                    void toggleReaction(
                                      message,
                                      row.emoji || `:${row.shortcode}:`,
                                    )
                                  }
                                >
                                  {row.imageUrl ? (
                                    <img
                                      src={row.imageUrl}
                                      alt={`:${row.shortcode}:`}
                                      width={22}
                                      height={22}
                                    />
                                  ) : (
                                    row.emoji
                                  )}
                                </button>
                              ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="reaction-picker-section">
                        <p className="reaction-picker-label">All</p>
                        <div className="reaction-picker-grid">
                          {[...QUICK_REACTIONS, ...MORE_REACTIONS]
                            .filter((emoji, index, all) => {
                              if (all.indexOf(emoji) !== index) {
                                return false;
                              }
                              const q = reactPickerQuery.trim().toLowerCase();
                              if (!q) {
                                return true;
                              }
                              return emoji.includes(reactPickerQuery.trim());
                            })
                            .map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() =>
                                  void toggleReaction(message, emoji)
                                }
                              >
                                {emoji}
                              </button>
                            ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })(),
            document.body,
          )
        : null}

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

      {filteredSlashCommands.length > 0 && slashQuery !== null ? (
        <ul className="mention-picker slash-picker" role="listbox" aria-label="Slash commands">
          {filteredSlashCommands.map((item, index) => (
            <li key={item.name}>
              <button
                type="button"
                className={index === slashHighlight ? 'is-active' : undefined}
                onClick={() => insertSlashCommand(item.name)}
              >
                <strong>/{item.name}</strong>
                <small className="muted"> {item.description}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {filteredMentions.length > 0 && mentionQuery ? (
        <ul className="mention-picker">
          {filteredMentions.slice(0, 8).map((member) => (
            <li key={member.userId}>
              <button
                type="button"
                onClick={() => insertMention(member.label, member.special)}
              >
                {member.special
                  ? `@${member.label}`
                  : `@${member.label.replace(/\s+/g, '')}`}
                {member.hint ? (
                  <small className="muted"> {member.hint}</small>
                ) : null}
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

      {scheduleOpen && !editingMessage && !conversation.blockedMe ? (
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

      {conversation.type === 'private' && conversation.blockedByMe ? (
        <div className="blocked-chat-banner" role="status">
          <p>
            You blocked this contact. Tap unblock to allow messaging again. You
            can still send messages; they will not be delivered.
          </p>
          <button className="btn" type="button" onClick={() => void unblockPeer()}>
            Unblock
          </button>
        </div>
      ) : null}

      {conversation.type === 'private' && conversation.blockedMe ? (
        <div className="blocked-chat-composer" role="status">
          <p>You can&apos;t message this contact.</p>
          <Link className="ghost" to="/blocked">
            Manage blocked users
          </Link>
        </div>
      ) : announceOnlyLocked ? (
        <div className="announce-only-composer" role="status">
          <div className="announce-only-faux-input" aria-hidden="true">
            Message #{(conversation.name || 'channel').replace(/^#/, '')}
          </div>
          <p>
            This is an <strong>announcement</strong> channel. Only owners and
            admins can post — you can still read and react.
          </p>
        </div>
      ) : (
      <div className="composer-stack">
      {conversation.announceOnly && canManageChannel ? (
        <p className="announce-admin-hint muted" role="note">
          Announcement channel — members can read, only admins can post.
        </p>
      ) : null}

      {askOpen && !editingMessage ? (
        <div className="channel-ask-panel" role="region" aria-label="Ask Relay">
          <div className="channel-ask-head">
            <div>
              <strong>Ask about this channel</strong>
              <p className="muted">
                Type a normal question — no slash commands needed.
              </p>
            </div>
            <button
              type="button"
              className="ghost icon-btn"
              aria-label="Close Ask Relay"
              onClick={() => {
                setAskOpen(false);
                setAskError('');
              }}
            >
              ×
            </button>
          </div>
          <form
            className="channel-ask-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runChannelAsk();
            }}
          >
            <input
              ref={askInputRef}
              value={askQuestion}
              onChange={(event) => setAskQuestion(event.target.value)}
              placeholder="e.g. What decisions were made here?"
              aria-label="Ask a question about this channel"
              disabled={askBusy}
            />
            <button
              className="btn"
              type="submit"
              disabled={askBusy || askQuestion.trim().length < 3}
            >
              {askBusy ? 'Asking…' : 'Ask'}
            </button>
          </form>
          {askBusy ? (
            <p className="muted channel-ask-status">Reading this channel…</p>
          ) : null}
          {askError ? <p className="error channel-ask-status">{askError}</p> : null}
          {askResult ? (
            <div className="channel-ask-result">
              <div className="channel-ask-result-head">
                <strong>Answer</strong>
                <span className="muted">
                  {askResult.poweredByAi ? 'AI · this channel' : 'This channel'}
                </span>
              </div>
              <pre className="channel-ask-answer">{askResult.answer}</pre>
              {askResult.citations.length > 0 ? (
                <div className="channel-ask-citations">
                  {askResult.citations.map((citation, index) => (
                    <button
                      key={`${citation.messageId}-${index}`}
                      type="button"
                      className="channel-ask-citation"
                      onClick={() => jumpToMessage(citation.messageId)}
                    >
                      <span>{index + 1}</span>
                      <small>{citation.bodySnippet}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <form
        className={`composer${editingMessage ? ' edit-mode' : ''}${
          voicePhase !== 'idle' ? ' voice-mode' : ''
        }${formatToolbarOpen ? ' format-open' : ''}${
          conversation.announceOnly && canManageChannel
            ? ' announce-admin-composer'
            : ''
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
            {!editingMessage &&
            !composer.trim() &&
            voicePhase === 'idle' &&
            (smartRepliesBusy || smartReplies.length > 0) ? (
              <div className="smart-replies" aria-label="Suggested replies">
                {smartRepliesBusy && smartReplies.length === 0 ? (
                  <span className="smart-replies-hint muted">Suggesting replies…</span>
                ) : (
                  <>
                    <span className="smart-replies-label">
                      {smartRepliesAi ? 'AI suggestions' : 'Quick replies'}
                    </span>
                    {smartReplies.map((reply) => (
                      <button
                        key={reply}
                        type="button"
                        className="smart-reply-chip"
                        onClick={() => {
                          setComposer(reply);
                          window.setTimeout(
                            () => composerInputRef.current?.focus(),
                            20,
                          );
                        }}
                      >
                        {reply}
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : null}
            <div className="composer-box">
              {formatToolbarOpen ? (
                <div
                  className="composer-format-bar"
                  role="toolbar"
                  aria-label="Text formatting"
                >
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Bold (Ctrl/⌘+B)"
                    aria-label="Bold"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyComposerFormat('*', 'bold')}
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Italic (Ctrl/⌘+I)"
                    aria-label="Italic"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyComposerFormat('_', 'italic')}
                  >
                    <em>I</em>
                  </button>
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Strikethrough"
                    aria-label="Strikethrough"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyComposerFormat('~', 'strike')}
                  >
                    <s>S</s>
                  </button>
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Link"
                    aria-label="Insert link"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={insertComposerLink}
                  >
                    🔗
                  </button>
                  <span className="composer-format-sep" aria-hidden="true" />
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Bulleted list"
                    aria-label="Bulleted list"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyComposerPrefix('- ')}
                  >
                    •
                  </button>
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Numbered list"
                    aria-label="Numbered list"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyComposerPrefix('1. ')}
                  >
                    1.
                  </button>
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Quote"
                    aria-label="Quote"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyComposerPrefix('> ')}
                  >
                    “
                  </button>
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Code"
                    aria-label="Inline code"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyComposerFormat('`', 'code')}
                  >
                    {'</>'}
                  </button>
                  <button
                    type="button"
                    className="composer-format-btn"
                    title="Code block"
                    aria-label="Code block"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyComposerPrefix('```\n')}
                  >
                    ▢
                  </button>
                </div>
              ) : null}

              <textarea
                ref={composerInputRef}
                className="composer-input"
                rows={composer.trim() || replyTo || editingMessage ? 3 : 2}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={onComposerKeyDown}
                onFocus={() => void sendTyping(true)}
                onBlur={() => void sendTyping(false)}
                placeholder={
                  editingMessage
                    ? 'Edit message'
                    : replyTo
                      ? 'Type a reply…'
                      : conversation.type === 'group'
                        ? `Message #${(conversation.name || 'channel').replace(/^#/, '')}`
                        : `Message ${title}`
                }
                autoComplete="off"
              />

              <div className="composer-actions">
                <div className="composer-actions-left">
                  {!editingMessage ? (
                    <div className="composer-attach-wrap" ref={attachMenuRef}>
                      <button
                        className={`composer-tool${attachMenuOpen ? ' open' : ''}`}
                        type="button"
                        aria-label="Attach"
                        title="Attach"
                        aria-expanded={attachMenuOpen}
                        disabled={uploading}
                        onClick={() => setAttachMenuOpen((open) => !open)}
                      >
                        {uploading ? '…' : '+'}
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
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setAttachMenuOpen(false);
                              setPollOpen(true);
                            }}
                          >
                            Poll
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {!editingMessage &&
                  (conversation.type === 'group' ||
                    conversation.type === 'private') ? (
                    <button
                      className={`composer-tool${inThisHuddle ? ' open' : ''}`}
                      type="button"
                      aria-label={inThisHuddle ? 'In huddle' : 'Start huddle'}
                      title={
                        inThisHuddle
                          ? 'You are in this huddle'
                          : 'Huddle — ambient audio, no ringing'
                      }
                      disabled={
                        callPhase !== 'idle' || Boolean(ongoingLobby?.active)
                      }
                      onClick={() => void startHuddle(conversation.id)}
                    >
                      <HuddleIcon size={18} />
                    </button>
                  ) : null}

                  {!editingMessage ? (
                    <button
                      className={`composer-tool composer-ask-tool${
                        askOpen ? ' open' : ''
                      }`}
                      type="button"
                      aria-label="Ask about this channel"
                      title="Ask Relay about this channel"
                      aria-pressed={askOpen}
                      onClick={() => {
                        if (askOpen) {
                          setAskOpen(false);
                        } else {
                          openChannelAsk();
                        }
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2zm-1 18h2v2h-2v-2z"
                        />
                      </svg>
                    </button>
                  ) : null}

                  {!editingMessage ? (
                    <button
                      className="composer-tool"
                      type="button"
                      aria-label="Record voice note"
                      title="Record voice note"
                      disabled={uploading}
                      onClick={() => void startVoiceRecording()}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"
                        />
                      </svg>
                    </button>
                  ) : null}

                  <span className="composer-actions-sep" aria-hidden="true" />

                  <div className="composer-emoji-wrap">
                    <button
                      className={`composer-tool${composerEmojiOpen ? ' open' : ''}`}
                      type="button"
                      aria-label="Emoji"
                      title="Emoji"
                      aria-expanded={composerEmojiOpen}
                      onClick={() => setComposerEmojiOpen((open) => !open)}
                    >
                      🙂
                    </button>
                    {composerEmojiOpen ? (
                      <div className="composer-emoji-menu" role="menu">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            role="menuitem"
                            onClick={() => insertComposerSnippet(emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <button
                    className="composer-tool"
                    type="button"
                    aria-label="Mention someone"
                    title="Mention"
                    onClick={() => insertComposerSnippet('@')}
                  >
                    @
                  </button>

                  <button
                    className={`composer-tool composer-format-toggle${
                      formatToolbarOpen ? ' active' : ''
                    }`}
                    type="button"
                    aria-label="Text formatting"
                    title="Formatting"
                    aria-pressed={formatToolbarOpen}
                    onClick={() => setFormatToolbarOpen((open) => !open)}
                  >
                    Aa
                  </button>
                </div>

                <div className="composer-actions-right">
                  {editingMessage || composer.trim() ? (
                    <div className="composer-send-group">
                      <button
                        className="composer-send"
                        type="submit"
                        aria-label={editingMessage ? 'Save edit' : 'Send message'}
                        title={editingMessage ? 'Save' : 'Send'}
                        disabled={!composer.trim()}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"
                          />
                        </svg>
                      </button>
                      {!editingMessage ? (
                        <button
                          className={`composer-send-more${scheduleOpen ? ' active' : ''}`}
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
                          ▾
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </form>
      </div>
      )}
      </>
      ) : null}
      </div>

      {activeThreadRoot ? (
        <aside className="thread-side-panel" aria-label="Thread">
          <header className="thread-side-head">
            <div className="thread-side-head-main">
              <button
                type="button"
                className="ghost thread-tool-btn thread-side-back"
                aria-label="Close thread"
                title="Back"
                onClick={closeThreadPanel}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"
                  />
                </svg>
              </button>
              <div className="thread-side-titles">
                <h3>Thread</h3>
                <p className="muted">{title}</p>
              </div>
            </div>
            <div className="thread-side-head-actions">
              <button
                type="button"
                className="ghost thread-unfollow-btn"
                title="Unfollow this thread"
                onClick={() => void unfollowActiveThread()}
              >
                Unfollow
              </button>
              <button
                type="button"
                className="ghost icon-btn thread-side-close"
                aria-label="Close thread"
                title="Close"
                onClick={closeThreadPanel}
              >
                ×
              </button>
            </div>
          </header>

          <div className="slack-thread">
            <div className="slack-thread-scroll">
              <article className="slack-thread-msg is-root">
                <UserHoverCard
                  userId={activeThreadRoot.senderId}
                  profile={
                    activeThreadRoot.botUsername
                      ? null
                      : byUserId.get(activeThreadRoot.senderId)
                  }
                  member={memberByUserId.get(activeThreadRoot.senderId)}
                  isBot={Boolean(activeThreadRoot.botUsername)}
                >
                  <UserAvatar
                    profile={
                      activeThreadRoot.botUsername
                        ? null
                        : byUserId.get(activeThreadRoot.senderId)
                    }
                    name={
                      activeThreadRoot.botUsername?.trim() ||
                      displayName(byUserId.get(activeThreadRoot.senderId))
                    }
                    imageUrl={
                      activeThreadRoot.botUsername
                        ? activeThreadRoot.botIconUrl
                        : null
                    }
                    size="sm"
                    className="slack-thread-avatar"
                  />
                </UserHoverCard>
                <div className="slack-thread-msg-body">
                  <header className="slack-thread-msg-head">
                    <span
                      className={`slack-thread-author${
                        activeThreadRoot.botUsername ? ' is-bot' : ''
                      }`}
                    >
                      {activeThreadRoot.botUsername?.trim() ? (
                        <>
                          {activeThreadRoot.botUsername.trim()}
                          <span className="wa-bot-badge">APP</span>
                        </>
                      ) : (
                        <UserHoverCard
                          userId={activeThreadRoot.senderId}
                          profile={byUserId.get(activeThreadRoot.senderId)}
                          member={memberByUserId.get(activeThreadRoot.senderId)}
                        >
                          <span className="slack-thread-author-name">
                            {displayName(
                              byUserId.get(activeThreadRoot.senderId),
                            )}
                          </span>
                        </UserHoverCard>
                      )}
                    </span>
                    <time dateTime={activeThreadRoot.createdAt}>
                      {clock(activeThreadRoot.createdAt)}
                    </time>
                  </header>
                  <div className="slack-thread-text">
                    <MentionedText
                      body={activeThreadRoot.body}
                      mentionLabels={mentionRenderLabels}
                      userGroupHandles={userGroupHandles}
                      selfId={me}
                      messageId={activeThreadRoot.id}
                    />
                  </div>
                </div>
              </article>

              {threadReplies.length > 0 || threadLoading ? (
                <div className="slack-thread-divider" role="presentation">
                  <span>
                    {threadReplies.length}{' '}
                    {threadReplies.length === 1 ? 'reply' : 'replies'}
                  </span>
                </div>
              ) : null}

              {threadLoading && threadReplies.length === 0 ? (
                <p className="muted slack-thread-empty">Loading replies…</p>
              ) : null}

              <ul className="slack-thread-list">
                {threadReplies.map((reply) => {
                  const isBot = Boolean(reply.botUsername?.trim());
                  return (
                    <li key={reply.id}>
                      <article className="slack-thread-msg">
                        <UserHoverCard
                          userId={reply.senderId}
                          profile={
                            isBot ? null : byUserId.get(reply.senderId)
                          }
                          member={memberByUserId.get(reply.senderId)}
                          isBot={isBot}
                        >
                          <UserAvatar
                            profile={
                              isBot ? null : byUserId.get(reply.senderId)
                            }
                            name={
                              reply.botUsername?.trim() ||
                              displayName(byUserId.get(reply.senderId))
                            }
                            imageUrl={isBot ? reply.botIconUrl : null}
                            size="sm"
                            className="slack-thread-avatar"
                          />
                        </UserHoverCard>
                        <div className="slack-thread-msg-body">
                          <header className="slack-thread-msg-head">
                            <span
                              className={`slack-thread-author${
                                isBot ? ' is-bot' : ''
                              }`}
                            >
                              {isBot ? (
                                <>
                                  {reply.botUsername?.trim() ||
                                    displayName(byUserId.get(reply.senderId))}
                                  <span className="wa-bot-badge">APP</span>
                                </>
                              ) : (
                                <UserHoverCard
                                  userId={reply.senderId}
                                  profile={byUserId.get(reply.senderId)}
                                  member={memberByUserId.get(reply.senderId)}
                                >
                                  <span className="slack-thread-author-name">
                                    {displayName(byUserId.get(reply.senderId))}
                                  </span>
                                </UserHoverCard>
                              )}
                            </span>
                            <time dateTime={reply.createdAt}>
                              {clock(reply.createdAt)}
                            </time>
                          </header>
                          <div className="slack-thread-text">
                            <MentionedText
                              body={reply.body}
                              mentionLabels={mentionRenderLabels}
                              userGroupHandles={userGroupHandles}
                              selfId={me}
                              messageId={reply.id}
                            />
                          </div>
                          {reply.translatedText ? (
                            <div className="wa-translation">
                              <p className="wa-text wa-translated">
                                {reply.showOriginal
                                  ? reply.body
                                  : reply.translatedText}
                              </p>
                              <button
                                type="button"
                                className="wa-translation-toggle"
                                onClick={() => toggleShowOriginal(reply)}
                              >
                                {reply.showOriginal
                                  ? 'Show translation'
                                  : 'Show original'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </div>

            {announceOnlyLocked ? (
              <p className="muted announce-thread-lock">
                Only owners and admins can reply in announcement channels.
              </p>
            ) : (
              <form
                className="slack-thread-composer"
                onSubmit={(event) => void sendThreadReply(event)}
              >
                <div className="composer-box">
                  <MrkdwnEditor
                    hint={null}
                    rows={3}
                    value={threadComposer}
                    disabled={threadBusy}
                    onChange={setThreadComposer}
                    onModEnter={() => void sendThreadReply()}
                    placeholder="Reply…"
                    className="slack-thread-editor"
                  />
                  <div className="composer-actions">
                    <div className="composer-actions-left">
                      {conversation?.type === 'group' ? (
                        <label className="thread-also-channel profile-check">
                          <span className="profile-check-row">
                            <input
                              type="checkbox"
                              checked={alsoSendToChannel}
                              onChange={(event) =>
                                setAlsoSendToChannel(event.target.checked)
                              }
                            />
                            Also send to{' '}
                            {title.startsWith('#') ? title : `#${title}`}
                          </span>
                        </label>
                      ) : (
                        <span />
                      )}
                    </div>
                    <div className="composer-actions-right">
                      {threadComposer.trim() ? (
                        <div className="composer-send-group">
                          <button
                            className="composer-send"
                            type="submit"
                            disabled={threadBusy || !threadComposer.trim()}
                            aria-label="Send"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="18"
                              height="18"
                              aria-hidden="true"
                            >
                              <path
                                fill="currentColor"
                                d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"
                              />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                {filteredThreadMentions.length > 0 && threadMentionQuery ? (
                  <ul className="mention-picker">
                    {filteredThreadMentions.slice(0, 8).map((member) => (
                      <li key={member.userId}>
                        <button
                          type="button"
                          onClick={() =>
                            insertThreadMention(member.label, member.special)
                          }
                        >
                          {member.special
                            ? `@${member.label}`
                            : `@${member.label.replace(/\s+/g, '')}`}
                          {member.hint ? (
                            <small className="muted"> {member.hint}</small>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </form>
            )}
          </div>
        </aside>
      ) : null}

      <Modal
        open={savedOpen}
        title="Saved messages"
        onClose={() => setSavedOpen(false)}
      >
        <div className="saved-messages-panel">
          {savedBusy && savedItems.length === 0 ? (
            <p className="muted">Loading saved messages…</p>
          ) : null}
          {!savedBusy && savedItems.length === 0 ? (
            <p className="muted">
              Save any message from the ⋮ menu. They show up here across chats.
            </p>
          ) : null}
          <ul className="saved-messages-list">
            {savedItems.map((item) => {
              const inThisChat = item.conversationId === id;
              const title =
                item.conversationName?.trim() ||
                (item.conversationType === 'group' ? 'Channel' : 'Direct message');
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="saved-message-row"
                    onClick={() => {
                      setSavedOpen(false);
                      if (inThisChat) {
                        if (messagesRef.current.some((m) => m.id === item.messageId)) {
                          jumpToMessage(item.messageId);
                          return;
                        }
                        setSearchParams(
                          (current) => {
                            const next = new URLSearchParams(current);
                            next.set('focus', item.messageId);
                            return next;
                          },
                          { replace: true },
                        );
                        return;
                      }
                      navigate(
                        `/chat/${item.conversationId}?focus=${encodeURIComponent(item.messageId)}`,
                      );
                    }}
                  >
                    <strong>{title}</strong>
                    <span>{replySnippet(item.message)}</span>
                    <small>{clock(item.createdAt)}</small>
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void toggleBookmark(item.message)}
                  >
                    Unsave
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Modal>

      <Modal
        open={pollOpen}
        title="Create poll"
        onClose={() => {
          if (!pollBusy) {
            setPollOpen(false);
          }
        }}
      >
        <div className="poll-form">
          <label>
            Question
            <input
              value={pollQuestion}
              onChange={(event) => setPollQuestion(event.target.value)}
              maxLength={240}
              placeholder="What should we decide?"
              autoFocus
            />
          </label>
          <div className="poll-form-options">
            <p className="muted">Options</p>
            {pollOptions.map((option, index) => (
              <label key={`poll-opt-${index}`}>
                Option {index + 1}
                <input
                  value={option}
                  onChange={(event) => {
                    const next = [...pollOptions];
                    next[index] = event.target.value;
                    setPollOptions(next);
                  }}
                  maxLength={80}
                  placeholder={`Choice ${index + 1}`}
                />
              </label>
            ))}
            {pollOptions.length < 6 ? (
              <button
                type="button"
                className="ghost"
                onClick={() => setPollOptions((current) => [...current, ''])}
              >
                Add option
              </button>
            ) : null}
          </div>
          <label className="poll-form-check">
            <input
              type="checkbox"
              checked={pollAllowMultiple}
              onChange={(event) => setPollAllowMultiple(event.target.checked)}
            />
            Allow multiple answers
          </label>
          <div className="poll-form-actions">
            <button
              type="button"
              className="ghost"
              disabled={pollBusy}
              onClick={() => setPollOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={
                pollBusy ||
                pollQuestion.trim().length < 2 ||
                pollOptions.map((item) => item.trim()).filter(Boolean).length < 2
              }
              onClick={() => void createPoll()}
            >
              {pollBusy ? 'Creating…' : 'Create poll'}
            </button>
          </div>
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
        open={catchUpOpen}
        title="Catch me up"
        onClose={() => setCatchUpOpen(false)}
      >
        <div className="catch-up-modal">
          <p className="muted modal-lead">
            {catchUpBusy
              ? 'Summarizing unread messages…'
              : catchUpUnreadCount > 0
                ? `Recap of ${catchUpUnreadCount} unread message${
                    catchUpUnreadCount === 1 ? '' : 's'
                  }`
                : 'Unread recap'}
            {catchUpPoweredByAi ? ' · AI' : catchUpSummary ? ' · local summary' : ''}
          </p>
          {catchUpError ? <p className="error">{catchUpError}</p> : null}
          {catchUpBusy && !catchUpSummary ? (
            <p className="muted">Working on it…</p>
          ) : null}
          {catchUpSummary ? (
            <pre className="thread-summary catch-up-summary">{catchUpSummary}</pre>
          ) : null}
          <div className="modal-actions catch-up-actions">
            {catchUpFirstUnreadId ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const target = catchUpFirstUnreadId;
                  setCatchUpOpen(false);
                  jumpToMessage(target);
                }}
              >
                Jump to first unread
              </button>
            ) : null}
            <button
              type="button"
              className="ghost"
              onClick={() => setCatchUpOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(editHistory)}
        title="Edit history"
        onClose={() => setEditHistory(null)}
      >
        {editHistory ? (
          <div className="edit-history">
            <p className="muted modal-lead">
              Previous versions of this message, oldest first.
            </p>
            {editHistory.versions.length === 0 ? (
              <p className="muted">
                No prior versions stored yet (edits made before history was
                enabled).
              </p>
            ) : (
              <ol className="edit-history-list">
                {editHistory.versions.map((version, index) => (
                  <li key={version.id}>
                    <header>
                      <strong>Version {index + 1}</strong>
                      <time dateTime={version.createdAt}>
                        {new Date(version.createdAt).toLocaleString()}
                      </time>
                    </header>
                    <p>{version.body}</p>
                  </li>
                ))}
              </ol>
            )}
            <div className="edit-history-current">
              <header>
                <strong>Current</strong>
                {editHistory.currentEditedAt ? (
                  <time dateTime={editHistory.currentEditedAt}>
                    {new Date(editHistory.currentEditedAt).toLocaleString()}
                  </time>
                ) : null}
              </header>
              <p>{editHistory.currentBody}</p>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={topicDetailsOpen}
        title="Channel topic"
        onClose={() => setTopicDetailsOpen(false)}
      >
        {conversation ? (
          <div className="channel-topic-details">
            <dl className="conversation-details-meta">
              <div>
                <dt>Topic</dt>
                <dd>{conversation.topic?.trim() || 'No topic'}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>
                  {conversation.description?.trim() || 'No description yet'}
                </dd>
              </div>
              <div>
                <dt>Posting</dt>
                <dd>
                  {conversation.announceOnly
                    ? 'Announcement only — owners & admins'
                    : 'Everyone can post'}
                </dd>
              </div>
              {(conversation.bookmarks?.length ?? 0) > 0 ? (
                <div>
                  <dt>Bookmarks</dt>
                  <dd style={{ textAlign: 'left' }}>
                    <ul className="channel-bookmarks-manage">
                      {conversation.bookmarks?.map((bookmark) => (
                        <li key={bookmark.id}>
                          <a
                            href={bookmark.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {bookmark.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="modal-actions">
              <button
                className="btn full"
                type="button"
                onClick={() => {
                  setTopicDetailsOpen(false);
                  navigate(`/chat/${id}/details`);
                }}
              >
                Open channel details
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

    </div>
  );
}
