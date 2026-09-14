import { getAccessToken } from '../auth/session';
import { resolveMediaUrl } from '../components/VoiceNotePlayer';

export type MediaAccessContext = {
  conversationId?: string;
  messageId?: string;
  mime?: string;
};

function safeFilename(filename: string): string {
  return (filename || 'download').replace(/[\\/:*?"<>|]+/g, '_');
}

function guessMime(filename: string, mime?: string): string {
  const cleaned = (mime ?? '').trim();
  if (cleaned && cleaned !== 'application/octet-stream') {
    return cleaned;
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  return 'application/octet-stream';
}

function isLocalPending(url: string, messageId?: string): boolean {
  return (
    !messageId ||
    messageId.startsWith('local-') ||
    url.startsWith('blob:')
  );
}

async function fetchAttachmentBlob(
  url: string,
  filename: string,
  context?: MediaAccessContext,
  disposition: 'inline' | 'attachment' = 'attachment',
): Promise<Blob> {
  const conversationId = context?.conversationId;
  const messageId = context?.messageId;
  const mime = guessMime(filename, context?.mime);

  if (conversationId && messageId && !isLocalPending(url, messageId)) {
    const token = getAccessToken();
    const response = await fetch(
      `/api/chat/conversations/${conversationId}/messages/${messageId}/download?disposition=${disposition}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'ngrok-skip-browser-warning': 'true',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }
    const raw = await response.blob();
    // Force a correct MIME so Chrome's PDF viewer can open the blob tab.
    return new Blob([raw], { type: mime || raw.type || 'application/octet-stream' });
  }

  const resolved = resolveMediaUrl(url);
  const response = await fetch(resolved);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const raw = await response.blob();
  return new Blob([raw], { type: mime || raw.type || 'application/octet-stream' });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeFilename(filename);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

/** Force a download via the authenticated attachment proxy. */
export async function downloadMedia(
  url: string,
  filename: string,
  context?: MediaAccessContext,
): Promise<void> {
  try {
    const blob = await fetchAttachmentBlob(url, filename, context, 'attachment');
    triggerBlobDownload(blob, filename);
  } catch {
    window.open(resolveMediaUrl(url), '_blank', 'noopener,noreferrer');
  }
}

/**
 * Open/view media in a new tab via the authenticated proxy.
 * PDFs/images/text open in the browser; other files fall back to download.
 */
export async function openMedia(
  url: string,
  filename: string,
  context?: MediaAccessContext,
): Promise<void> {
  const mime = guessMime(filename, context?.mime);
  const canInline =
    mime === 'application/pdf' ||
    mime.startsWith('image/') ||
    mime.startsWith('text/') ||
    mime === 'application/json';

  try {
    const blob = await fetchAttachmentBlob(
      url,
      filename,
      context,
      canInline ? 'inline' : 'attachment',
    );
    if (!canInline) {
      triggerBlobDownload(blob, filename);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const opened = window.open(objectUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
      // Popup blocked — fall back to download
      triggerBlobDownload(blob, filename);
      URL.revokeObjectURL(objectUrl);
      return;
    }
    // Revoke later so the viewer has time to load the blob
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch {
    // Last resort: download through proxy path again, or open public URL
    try {
      await downloadMedia(url, filename, context);
    } catch {
      window.open(resolveMediaUrl(url), '_blank', 'noopener,noreferrer');
    }
  }
}

export function isBrowserViewableAttachment(
  filename: string,
  mime?: string,
): boolean {
  const type = guessMime(filename, mime);
  return (
    type === 'application/pdf' ||
    type.startsWith('image/') ||
    type.startsWith('text/') ||
    type === 'application/json'
  );
}
