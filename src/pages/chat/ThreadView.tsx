import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { getAccessToken } from '../../auth/session';
import { useAuth } from '../../auth/AuthContext';
import { useChatSocket } from '../../chat/ChatSocketContext';
import { Modal } from '../../components/Modal';
import { MessageTicks } from '../../components/MessageTicks';
import { PeoplePicker } from '../../components/PeoplePicker';
import {
  clock,
  conversationTitle,
  displayName,
  formatLastSeen,
  otherMember,
} from '../../lib/format';
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
import { useDirectory } from '../../people/useDirectory';
import type {
  ChatMessage,
  Conversation,
  LinkPreview,
  Paginated,
  SeenResult,
} from '../../api/types';
import type { MessengerOutletContext } from './MessengerPage';

const DELETE_FOR_EVERYONE_MS = 60 * 60 * 1000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    reactions: message.reactions ?? [],
    attachment: message.attachment ?? null,
    mentions: message.mentions ?? [],
    linkPreview: message.linkPreview ?? null,
    editedAt: message.editedAt ?? null,
    forwarded: Boolean(message.forwarded),
  };
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

export function ThreadView() {
  const { id = '' } = useParams();
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const [pendingLinkPreview, setPendingLinkPreview] = useState<LinkPreview | null>(null);
  const [summary, setSummary] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { joinConversation, subscribe, emit } = useChatSocket();

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

  async function load() {
    setLoading(true);
    setConversation(null);
    setMessages([]);
    setSummary('');
    const conv = await api<Conversation>(`/chat/conversations/${id}`);
    await loadHistory(1, false);
    setConversation({
      ...conv.data,
      muted: Boolean(conv.data.muted),
      pinned: Boolean(conv.data.pinned),
    });
    setLoading(false);
    clearUnread(id);
    void ensureProfiles(conv.data.members.map((member) => member.userId));
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
    setHighlightId(null);
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
        setMessages((current) => upsertMessage(current, message));
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
        setMessages((current) =>
          current.map((item) =>
            item.id === message.id ? normalizeMessage(message) : item,
          ),
        );
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
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [id, me, clearUnread, joinConversation, navigate, subscribe]);

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

  function insertMention(label: string) {
    if (mentionQuery === null) {
      return;
    }
    const handle = label.replace(/\s+/g, '');
    const next = `${composer.slice(0, mentionQuery.start)}@${handle} `;
    setComposer(next);
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, {
          type: blob.type,
        });
        void uploadAndSend(file, 'audio');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setActionError('Microphone access is required for voice notes');
    }
  }

  async function uploadAndSend(file: File, kind: 'image' | 'audio' = 'image') {
    setUploading(true);
    setActionError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const token = getAccessToken();
      const uploadResponse = await fetch('/api/chat/uploads', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const uploadPayload = (await uploadResponse.json().catch(() => null)) as
        | {
            data?: { url: string; mime: string; name: string; size: number };
            message?: string;
          }
        | null;
      if (!uploadResponse.ok || !uploadPayload?.data) {
        throw new Error(uploadPayload?.message ?? 'Upload failed');
      }
      const attachment = uploadPayload.data;
      const caption = composer.trim();
      const response = await api<ChatMessage>(`/chat/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: caption || undefined,
          type: kind === 'audio' ? 'audio' : 'image',
          attachmentUrl: attachment.url,
          attachmentMime: attachment.mime,
          attachmentName: attachment.name,
          attachmentSize: attachment.size,
          replyToMessageId: replyTo?.id,
        }),
      });
      setMessages((current) => upsertMessage(current, response.data));
      setComposer('');
      clearMessageDraft(id);
      setReplyTo(null);
      setEditingMessage(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
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

  function canDeleteForEveryone(message: ChatMessage) {
    if (!me || message.senderId !== me || message.deletedForEveryone) {
      return false;
    }
    return Date.now() - new Date(message.createdAt).getTime() < DELETE_FOR_EVERYONE_MS;
  }

  function canEdit(message: ChatMessage) {
    if (!me || message.senderId !== me || message.deletedForEveryone) {
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
        <div className="thread-tools">
          <button
            className="ghost"
            type="button"
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen((open) => !open)}
          >
            Search
          </button>
          <button className="ghost" type="button" onClick={() => void togglePin()}>
            {conversation.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button className="ghost" type="button" onClick={() => void toggleMute()}>
            {conversation.muted ? 'Unmute' : 'Mute'}
          </button>
          <button className="ghost" type="button" onClick={() => setDetails(true)}>
            {conversation.type === 'group' ? 'Details' : 'Chat info'}
          </button>
        </div>
      </header>

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
          const mine = message.senderId === me;
          const seen = Boolean(
            mine && me && message.seenBy.some((userId) => userId !== me),
          );
          const menuOpen = menuMessageId === message.id;
          const showImage =
            !message.deletedForEveryone &&
            message.attachment &&
            (message.type === 'image' ||
              message.attachment.mime.startsWith('image/'));
          const showAudio =
            !message.deletedForEveryone &&
            message.attachment &&
            (message.type === 'audio' ||
              message.attachment.mime.startsWith('audio/'));
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
              }`}
              ref={(node) => {
                if (node) {
                  messageRefs.current.set(message.id, node);
                } else {
                  messageRefs.current.delete(message.id);
                }
              }}
            >
              <div
                className={mine ? 'wa-bubble mine' : 'wa-bubble theirs'}
                onContextMenu={(event) => {
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
                {message.replyTo ? (
                  <div className="wa-reply">
                    <strong>
                      {message.replyTo.deletedForEveryone
                        ? 'Deleted message'
                        : displayName(byUserId.get(message.replyTo.senderId))}
                    </strong>
                    <span>
                      {message.replyTo.deletedForEveryone
                        ? 'This message was deleted'
                        : message.replyTo.body}
                    </span>
                  </div>
                ) : null}
                {message.deletedForEveryone ? (
                  <p className="wa-text wa-deleted">This message was deleted</p>
                ) : (
                  <>
                    {showImage && message.attachment ? (
                      <a
                        className="wa-image-link"
                        href={message.attachment.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          className="wa-image"
                          src={message.attachment.url}
                          alt={message.attachment.name || 'Image'}
                          loading="lazy"
                        />
                      </a>
                    ) : null}
                    {showAudio && message.attachment ? (
                      <audio
                        className="wa-audio"
                        controls
                        preload="metadata"
                        src={message.attachment.url}
                      />
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
                {!message.deletedForEveryone && message.reactions.length > 0 ? (
                  <div className="wa-reactions">
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
                <span className="wa-meta">
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
                  {message.editedAt ? <span className="wa-edited">edited</span> : null}
                  <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
                  {mine ? <MessageTicks seen={seen} /> : null}
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
                          onClick={() => {
                            setReplyTo(message);
                            setEditingMessage(null);
                            setMenuMessageId(null);
                          }}
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
                      </>
                    ) : null}
                    <button type="button" onClick={() => void deleteMessage(message, false)}>
                      Delete for me
                    </button>
                    {canDeleteForEveryone(message) ? (
                      <button type="button" onClick={() => void deleteMessage(message, true)}>
                        Delete for everyone
                      </button>
                    ) : null}
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
            <span>{replyTo.deletedForEveryone ? 'This message was deleted' : replyTo.body}</span>
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

      <form
        className={`composer${editingMessage ? ' edit-mode' : ''}`}
        onSubmit={(event) => void send(event)}
      >
        {!editingMessage ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadAndSend(file);
                }
              }}
            />
            <button
              className="composer-attach"
              type="button"
              aria-label="Attach image"
              title="Attach image"
              disabled={uploading || recording}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <span className="composer-attach-busy">…</span>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
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
            <button
              className={`composer-voice${recording ? ' recording' : ''}`}
              type="button"
              aria-label={recording ? 'Stop recording' : 'Record voice note'}
              title={recording ? 'Stop recording' : 'Record voice note'}
              disabled={uploading}
              onClick={() => void toggleRecording()}
            >
              {recording ? '■' : '🎙'}
            </button>
          </>
        ) : null}
        <input
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onFocus={() => void sendTyping(true)}
          onBlur={() => void sendTyping(false)}
          placeholder={editingMessage ? 'Edit message' : 'Write a message'}
          autoComplete="off"
        />
        <button
          className="btn"
          type="submit"
          disabled={editingMessage ? !composer.trim() : !composer.trim()}
        >
          {editingMessage ? 'Save' : 'Send'}
        </button>
      </form>

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
