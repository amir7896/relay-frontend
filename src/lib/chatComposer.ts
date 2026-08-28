import type { LinkPreview } from '../api/types';

const URL_PATTERN = /https?:\/\/[^\s<]+[^\s<.,;:!?)]/gi;

export function firstUrl(text: string): string | null {
  const match = text.match(URL_PATTERN);
  return match?.[0] ?? null;
}

export function parseMentionQuery(
  composer: string,
): { query: string; start: number } | null {
  const match = composer.match(/@([\w.-]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }
  return { query: match[1].toLowerCase(), start: match.index };
}

export function extractMentionIds(
  body: string,
  members: { userId: string; label: string }[],
): string[] {
  const ids = new Set<string>();
  for (const member of members) {
    const handle = member.label.replace(/\s+/g, '').toLowerCase();
    if (body.toLowerCase().includes(`@${handle}`)) {
      ids.add(member.userId);
    }
  }
  return [...ids];
}

export function renderMessageBody(
  body: string,
  mentionLabels: Map<string, string>,
): Array<{ type: 'text' | 'mention'; value: string }> {
  const parts: Array<{ type: 'text' | 'mention'; value: string }> = [];
  const pattern = /@([\w.-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: body.slice(lastIndex, match.index) });
    }
    const token = match[1];
    const mentioned = [...mentionLabels.values()].some(
      (label) => label.replace(/\s+/g, '').toLowerCase() === token.toLowerCase(),
    );
    parts.push({
      type: mentioned ? 'mention' : 'text',
      value: match[0],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    parts.push({ type: 'text', value: body.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: 'text', value: body }];
}

export function isPlaceholderBody(body: string): boolean {
  return body === '[Image]' || body === '[File]' || body === '[Voice note]';
}

export type PendingLinkPreview = LinkPreview | null;
