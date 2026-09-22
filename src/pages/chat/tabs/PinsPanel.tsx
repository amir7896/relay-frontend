import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/client';
import type { ChatMessage } from '../../../api/types';
import { UserAvatar } from '../../../components/UserAvatar';
import { isPlaceholderBody, resolveSlackMentions } from '../../../lib/chatComposer';
import { clock, displayName } from '../../../lib/format';
import { useDirectory } from '../../../people/useDirectory';

type Props = {
  conversationId: string;
  onJumpToMessage?: (messageId: string) => void;
  onPinsChanged?: (items: ChatMessage[]) => void;
};

function pinSnippet(
  message: ChatMessage,
  labelForUserId: (userId: string) => string,
): string {
  if (message.deletedForEveryone) {
    return 'This message was deleted';
  }
  const body = message.body?.trim();
  if (body && !isPlaceholderBody(body)) {
    const resolved = resolveSlackMentions(body, labelForUserId)
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/~([^~]+)~/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    return resolved.length > 180 ? `${resolved.slice(0, 177)}…` : resolved;
  }
  const mime = message.attachment?.mime ?? '';
  if (mime.startsWith('image/') || message.type === 'image') return 'Photo';
  if (mime.startsWith('audio/') || message.type === 'audio') return 'Voice message';
  if (message.type === 'file' || message.attachment) {
    return message.attachment?.name || 'File';
  }
  if (message.type === 'poll') return 'Poll';
  if (message.type === 'call') return 'Call';
  return 'Message';
}

function normalizePinned(message: ChatMessage): ChatMessage {
  return {
    ...message,
    pinned: true,
    pinnedAt: message.pinnedAt ?? null,
    pinnedByUserId: message.pinnedByUserId ?? null,
    mentions: message.mentions ?? [],
    reactions: message.reactions ?? [],
    attachment: message.attachment ?? null,
    linkPreview: message.linkPreview ?? null,
    poll: message.poll ?? null,
  };
}

export function PinsPanel({
  conversationId,
  onJumpToMessage,
  onPinsChanged,
}: Props) {
  const { byUserId, ensureProfiles } = useDirectory();
  const onPinsChangedRef = useRef(onPinsChanged);
  onPinsChangedRef.current = onPinsChanged;
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unpinningId, setUnpinningId] = useState<string | null>(null);

  const mentionLabel = useCallback(
    (userId: string) => displayName(byUserId.get(userId)),
    [byUserId],
  );

  const publishPins = useCallback((next: ChatMessage[]) => {
    setItems(next);
    onPinsChangedRef.current?.(next);
  }, []);

  const loadPins = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await api<ChatMessage[]>(
        `/chat/conversations/${conversationId}/pinned-messages`,
      );
      const next = (Array.isArray(response.data) ? response.data : []).map(
        normalizePinned,
      );
      publishPins(next);
      const profileIds = new Set<string>();
      for (const item of next) {
        profileIds.add(item.senderId);
        if (item.pinnedByUserId) profileIds.add(item.pinnedByUserId);
        for (const mentionId of item.mentions ?? []) profileIds.add(mentionId);
      }
      if (profileIds.size) void ensureProfiles([...profileIds]);
    } catch (err) {
      publishPins([]);
      setError(err instanceof Error ? err.message : 'Could not load pinned messages');
    } finally {
      setBusy(false);
    }
  }, [conversationId, ensureProfiles, publishPins]);

  useEffect(() => {
    setQuery('');
    void loadPins();
  }, [loadPins]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const sender = displayName(byUserId.get(item.senderId)).toLowerCase();
      const pinner = item.pinnedByUserId
        ? displayName(byUserId.get(item.pinnedByUserId)).toLowerCase()
        : '';
      const snippet = pinSnippet(item, mentionLabel).toLowerCase();
      return (
        sender.includes(q) ||
        pinner.includes(q) ||
        snippet.includes(q) ||
        (item.body ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, query, byUserId, mentionLabel]);

  async function unpin(message: ChatMessage) {
    setUnpinningId(message.id);
    setError('');
    try {
      await api(`/chat/conversations/${conversationId}/messages/${message.id}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned: false }),
      });
      publishPins(items.filter((item) => item.id !== message.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unpin message');
    } finally {
      setUnpinningId(null);
    }
  }

  return (
    <div className="feature-panel pins-panel">
      <header className="feature-panel-head">
        <div>
          <h3>Pins</h3>
          <p className="muted">
            Important messages saved for this channel — jump back anytime.
          </p>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => void loadPins()}
          disabled={busy}
        >
          Refresh
        </button>
      </header>

      <div className="pins-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pinned messages…"
          aria-label="Search pinned messages"
        />
        <span className="muted pins-count">
          {filtered.length}
          {filtered.length !== items.length ? ` of ${items.length}` : ''} pinned
        </span>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {busy && items.length === 0 ? (
        <p className="muted">Loading pins…</p>
      ) : null}
      {!busy && items.length === 0 && !error ? (
        <div className="pins-empty">
          <p className="muted">No pinned messages yet.</p>
          <p className="muted pins-empty-hint">
            Pin a message from the message menu to keep it here.
          </p>
        </div>
      ) : null}
      {!busy && items.length > 0 && filtered.length === 0 ? (
        <p className="muted">No pins match “{query.trim()}”.</p>
      ) : null}

      {filtered.length > 0 ? (
        <ul className="pins-list">
          {filtered.map((item) => {
            const sender = displayName(byUserId.get(item.senderId));
            const pinner = item.pinnedByUserId
              ? displayName(byUserId.get(item.pinnedByUserId))
              : null;
            const when = item.pinnedAt || item.createdAt;
            return (
              <li key={item.id} className="pins-card">
                <div className="pins-card-main">
                  <UserAvatar
                    profile={byUserId.get(item.senderId)}
                    name={sender}
                    size="sm"
                  />
                  <div className="pins-card-copy">
                    <div className="pins-card-meta">
                      <strong>{sender}</strong>
                      <time dateTime={when}>{clock(when)}</time>
                    </div>
                    <p className="pins-card-body">{pinSnippet(item, mentionLabel)}</p>
                    {pinner ? (
                      <small className="muted">Pinned by {pinner}</small>
                    ) : null}
                  </div>
                </div>
                <div className="pins-card-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onJumpToMessage?.(item.id)}
                  >
                    Jump
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={unpinningId === item.id}
                    onClick={() => void unpin(item)}
                  >
                    {unpinningId === item.id ? 'Unpinning…' : 'Unpin'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
