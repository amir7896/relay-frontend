import { api } from '../api/client';

const DRAFT_PREFIX = 'relay.draft.';
const API_DEBOUNCE_MS = 600;

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function key(conversationId: string): string {
  return `${DRAFT_PREFIX}${conversationId}`;
}

function readLocal(conversationId: string): string {
  if (!conversationId) return '';
  try {
    return localStorage.getItem(key(conversationId)) ?? '';
  } catch {
    return '';
  }
}

function writeLocal(conversationId: string, body: string): void {
  if (!conversationId) return;
  try {
    if (!body) {
      localStorage.removeItem(key(conversationId));
      return;
    }
    localStorage.setItem(key(conversationId), body);
  } catch {
    // Ignore private-mode / quota failures
  }
}

function removeLocal(conversationId: string): void {
  if (!conversationId) return;
  try {
    localStorage.removeItem(key(conversationId));
  } catch {
    // Ignore storage failures
  }
}

/** Sync local read — prefer loadMessageDraft for API-first load. */
export function getMessageDraft(conversationId: string): string {
  return readLocal(conversationId);
}

/** Load draft from API first, then localStorage fallback. */
export async function loadMessageDraft(conversationId: string): Promise<string> {
  if (!conversationId) return '';
  try {
    const response = await api<{ body: string } | null>(
      `/chat/conversations/${conversationId}/draft`,
    );
    const body = response.data?.body ?? '';
    if (body) {
      writeLocal(conversationId, body);
      return body;
    }
    // Empty API draft — keep local if present (offline compose)
    return readLocal(conversationId);
  } catch {
    return readLocal(conversationId);
  }
}

export function setMessageDraft(conversationId: string, body: string): void {
  if (!conversationId) return;
  const trimmed = body;
  writeLocal(conversationId, trimmed);

  const existing = syncTimers.get(conversationId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    syncTimers.delete(conversationId);
    void (async () => {
      try {
        if (!trimmed.trim()) {
          await api(`/chat/conversations/${conversationId}/draft`, {
            method: 'DELETE',
          });
          return;
        }
        await api(`/chat/conversations/${conversationId}/draft`, {
          method: 'PUT',
          body: JSON.stringify({ body: trimmed.slice(0, 4000) }),
        });
      } catch {
        // Keep local draft; sync will retry on next edit
      }
    })();
  }, API_DEBOUNCE_MS);
  syncTimers.set(conversationId, timer);
}

export function clearMessageDraft(conversationId: string): void {
  if (!conversationId) return;
  const existing = syncTimers.get(conversationId);
  if (existing) {
    clearTimeout(existing);
    syncTimers.delete(conversationId);
  }
  removeLocal(conversationId);
  void api(`/chat/conversations/${conversationId}/draft`, {
    method: 'DELETE',
  }).catch(() => {
    // Ignore network failures on clear
  });
}
