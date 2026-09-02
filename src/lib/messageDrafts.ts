const DRAFT_PREFIX = 'relay.draft.';

function key(conversationId: string): string {
  return `${DRAFT_PREFIX}${conversationId}`;
}

export function getMessageDraft(conversationId: string): string {
  if (!conversationId) return '';
  try {
    return localStorage.getItem(key(conversationId)) ?? '';
  } catch {
    return '';
  }
}

export function setMessageDraft(conversationId: string, body: string): void {
  if (!conversationId) return;
  try {
    const trimmed = body;
    if (!trimmed) {
      localStorage.removeItem(key(conversationId));
      return;
    }
    localStorage.setItem(key(conversationId), trimmed);
  } catch {
    // Ignore private-mode / quota failures
  }
}

export function clearMessageDraft(conversationId: string): void {
  if (!conversationId) return;
  try {
    localStorage.removeItem(key(conversationId));
  } catch {
    // Ignore storage failures
  }
}
