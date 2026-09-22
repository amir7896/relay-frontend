import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { ChatMessage, Paginated } from '../../../api/types';
import { resolveMediaUrl } from '../../../components/VoiceNotePlayer';
import { downloadMedia, openMedia as openAttachmentMedia } from '../../../lib/downloadMedia';
import { clock } from '../../../lib/format';

export type MediaKindTab = 'all' | 'image' | 'file' | 'audio' | 'video';

type Props = {
  conversationId: string;
  initialKind?: MediaKindTab;
  onJumpToMessage?: (messageId: string) => void;
};

function mediaKindOf(message: ChatMessage): 'image' | 'file' | 'audio' | 'video' {
  const mime = message.attachment?.mime ?? '';
  const name = message.attachment?.name ?? '';
  if (mime.startsWith('video/') || /^clip-video-/i.test(name)) {
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
  if (kind === 'image') return 'photo.jpg';
  if (kind === 'audio') return 'voice-note.webm';
  if (kind === 'video') return 'clip.webm';
  return 'file';
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtLabel(name: string, mime: string): string {
  const fromName = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
  if (fromName && fromName.length <= 5) return fromName;
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('word') || mime.includes('document')) return 'DOC';
  if (mime.includes('sheet') || mime.includes('excel')) return 'XLS';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'PPT';
  if (mime.includes('json')) return 'JSON';
  if (mime.startsWith('text/')) return 'TXT';
  return 'FILE';
}

export function FilesPanel({
  conversationId,
  initialKind = 'all',
  onJumpToMessage,
}: Props) {
  const [kind, setKind] = useState<MediaKindTab>(initialKind);
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadMedia = useCallback(
    async (nextPage = 1, nextKind: MediaKindTab = kind, append = false) => {
      setBusy(true);
      setError('');
      try {
        const query =
          nextKind === 'all'
            ? `page=${nextPage}&limit=40`
            : `page=${nextPage}&limit=40&kind=${nextKind}`;
        const response = await api<Paginated<ChatMessage>>(
          `/chat/conversations/${conversationId}/media?${query}`,
        );
        const nextItems = response.data.items ?? [];
        setItems((current) => (append ? [...current, ...nextItems] : nextItems));
        setPage(nextPage);
        setHasMore(Boolean(response.data.meta.hasNextPage));
      } catch (err) {
        if (!append) setItems([]);
        setError(err instanceof Error ? err.message : 'Could not load files');
      } finally {
        setBusy(false);
      }
    },
    [conversationId, kind],
  );

  useEffect(() => {
    setKind(initialKind);
    setItems([]);
    setPage(1);
    setHasMore(false);
    void loadMedia(1, initialKind, false);
    // Reload when conversation or requested kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, initialKind]);

  async function handleDownload(message: ChatMessage) {
    if (!message.attachment?.url) return;
    setDownloadingId(message.id);
    try {
      await downloadMedia(message.attachment.url, mediaDownloadName(message), {
        conversationId,
        messageId: message.id,
        mime: message.attachment.mime,
      });
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleOpen(message: ChatMessage) {
    if (!message.attachment?.url) return;
    setDownloadingId(message.id);
    try {
      await openAttachmentMedia(
        message.attachment.url,
        mediaDownloadName(message),
        {
          conversationId,
          messageId: message.id,
          mime: message.attachment.mime,
        },
      );
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="feature-panel files-panel">
      <header className="feature-panel-head">
        <div>
          <h3>Files</h3>
          <p className="muted">Photos, documents, voice notes, and clips in this chat.</p>
        </div>
      </header>

      <div className="media-gallery files-panel-gallery">
        <div className="media-gallery-tabs" role="tablist" aria-label="Media type">
          {(
            [
              ['all', 'All'],
              ['image', 'Images'],
              ['video', 'Clips'],
              ['file', 'Files'],
              ['audio', 'Voice'],
            ] as const
          ).map(([tabKind, label]) => (
            <button
              key={tabKind}
              type="button"
              role="tab"
              aria-selected={kind === tabKind}
              className={kind === tabKind ? 'active' : ''}
              onClick={() => {
                if (kind === tabKind) return;
                setKind(tabKind);
                setItems([]);
                setPage(1);
                setHasMore(false);
                void loadMedia(1, tabKind, false);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <p className="error">{error}</p> : null}
        {busy && items.length === 0 ? (
          <p className="muted">Loading media…</p>
        ) : items.length === 0 && !error ? (
          <p className="muted">No media in this chat yet.</p>
        ) : (
          <ul className="media-gallery-list">
            {items.map((item) => {
              const itemKind = mediaKindOf(item);
              const attachment = item.attachment!;
              return (
                <li
                  key={item.id}
                  className={`media-gallery-item kind-${itemKind}`}
                >
                  <button
                    type="button"
                    className="media-gallery-preview"
                    onClick={() => onJumpToMessage?.(item.id)}
                    title="Show in chat"
                  >
                    {itemKind === 'image' ? (
                      <img
                        src={resolveMediaUrl(attachment.url)}
                        alt={attachment.name || 'Image'}
                        loading="lazy"
                      />
                    ) : itemKind === 'video' ? (
                      <video
                        src={resolveMediaUrl(attachment.url)}
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <span className="media-gallery-icon" aria-hidden="true">
                        {itemKind === 'audio'
                          ? '♪'
                          : fileExtLabel(attachment.name, attachment.mime)}
                      </span>
                    )}
                  </button>
                  <div className="media-gallery-meta">
                    <strong>
                      {itemKind === 'image'
                        ? attachment.name || 'Photo'
                        : itemKind === 'audio'
                          ? 'Voice note'
                          : itemKind === 'video'
                            ? attachment.name || 'Video clip'
                            : attachment.name || 'File'}
                    </strong>
                    <small>
                      {[
                        itemKind === 'image'
                          ? 'Image'
                          : itemKind === 'audio'
                            ? 'Voice'
                            : itemKind === 'video'
                              ? 'Clip'
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
                    disabled={downloadingId === item.id}
                    onClick={() => void handleOpen(item)}
                  >
                    {downloadingId === item.id ? '…' : 'Open'}
                  </button>
                  <button
                    type="button"
                    className="ghost media-gallery-download"
                    disabled={downloadingId === item.id}
                    onClick={() => void handleDownload(item)}
                  >
                    {downloadingId === item.id ? '…' : 'Download'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore ? (
          <button
            className="ghost full"
            type="button"
            disabled={busy}
            onClick={() => void loadMedia(page + 1, kind, true)}
          >
            {busy ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
