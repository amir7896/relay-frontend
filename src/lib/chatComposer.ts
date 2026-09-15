import type { LinkPreview } from '../api/types';

const URL_PATTERN = /https?:\/\/[^\s<]+[^\s<.,;:!?)]/gi;

export function firstUrl(text: string): string | null {
  const match = text.match(URL_PATTERN);
  return match?.[0] ?? null;
}

/** Compact handle used in stored `@Mention` tokens (spaces stripped). */
export function mentionHandle(label: string): string {
  return label.replace(/\s+/g, '').toLowerCase();
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

export function bodyHasChannelMention(body: string): boolean {
  return /(^|[\s([{])@channel\b/i.test(body);
}

export function bodyHasHereMention(body: string): boolean {
  return /(^|[\s([{])@here\b/i.test(body);
}

export function extractMentionIds(
  body: string,
  members: { userId: string; label: string }[],
): string[] {
  const ids = new Set<string>();
  const lower = body.toLowerCase();
  for (const member of members) {
    const handle = mentionHandle(member.label);
    if (!handle || handle === 'unknowncontact') continue;
    if (lower.includes(`@${handle}`)) {
      ids.add(member.userId);
    }
  }
  return [...ids];
}

export type MessageBodyPart = {
  type: 'text' | 'mention' | 'bold' | 'italic' | 'strike' | 'code' | 'link';
  value: string;
  userId?: string;
  href?: string;
  special?: 'channel' | 'here';
};

/**
 * Format a plain segment with Slack-lite mrkdwn:
 * `code`, *bold*, _italic_, ~strike~, and autolinked URLs.
 */
function formatPlainText(text: string): MessageBodyPart[] {
  if (!text) {
    return [];
  }
  const parts: MessageBodyPart[] = [];
  const pattern =
    /`([^`]+)`|\*([^*]+)\*|_([^_]+)_|~([^~]+)~|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ type: 'code', value: match[1] });
    } else if (match[2] !== undefined) {
      parts.push({ type: 'bold', value: match[2] });
    } else if (match[3] !== undefined) {
      parts.push({ type: 'italic', value: match[3] });
    } else if (match[4] !== undefined) {
      parts.push({ type: 'strike', value: match[4] });
    } else if (match[5] !== undefined) {
      parts.push({ type: 'link', value: match[5], href: match[5] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

/**
 * Split message body for display. Mentions render WhatsApp-style (name, no @);
 * @channel / @here stay as special mention chips; remaining text gets mrkdwn-lite.
 */
export function renderMessageBody(
  body: string,
  mentionLabels: Map<string, string>,
): MessageBodyPart[] {
  const byHandle = new Map<string, { userId: string; label: string }>();
  for (const [userId, label] of mentionLabels) {
    const handle = mentionHandle(label);
    if (!handle || handle === 'unknowncontact') continue;
    byHandle.set(handle, { userId, label });
  }

  const mentionParts: MessageBodyPart[] = [];
  const pattern = /@([\w.-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match.index > lastIndex) {
      mentionParts.push(
        ...formatPlainText(body.slice(lastIndex, match.index)),
      );
    }
    const token = match[1].toLowerCase();
    if (token === 'channel' || token === 'here') {
      mentionParts.push({
        type: 'mention',
        value: token,
        special: token,
      });
    } else {
      const hit = byHandle.get(token);
      if (hit) {
        mentionParts.push({
          type: 'mention',
          value: hit.label,
          userId: hit.userId,
        });
      } else {
        mentionParts.push(...formatPlainText(match[0]));
      }
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    mentionParts.push(...formatPlainText(body.slice(lastIndex)));
  }
  return mentionParts.length > 0
    ? mentionParts
    : [{ type: 'text', value: body }];
}

export function isPlaceholderBody(body: string): boolean {
  return body === '[Image]' || body === '[File]' || body === '[Voice note]';
}

export type FormatMarker = '*' | '_' | '~' | '`';

/**
 * Wrap the current selection (or insert a placeholder) with Slack-lite markers.
 * Toggles markers off when the selection is already wrapped.
 */
export function wrapComposerSelection(
  value: string,
  start: number,
  end: number,
  marker: FormatMarker,
  placeholder = 'text',
): { value: string; selectionStart: number; selectionEnd: number } {
  const from = Math.max(0, Math.min(start, end, value.length));
  const to = Math.max(0, Math.min(Math.max(start, end), value.length));
  const selected = value.slice(from, to);

  if (
    selected.length > marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, -marker.length);
    return {
      value: `${value.slice(0, from)}${inner}${value.slice(to)}`,
      selectionStart: from,
      selectionEnd: from + inner.length,
    };
  }

  if (selected) {
    const wrapped = `${marker}${selected}${marker}`;
    return {
      value: `${value.slice(0, from)}${wrapped}${value.slice(to)}`,
      selectionStart: from + marker.length,
      selectionEnd: from + marker.length + selected.length,
    };
  }

  const wrapped = `${marker}${placeholder}${marker}`;
  return {
    value: `${value.slice(0, from)}${wrapped}${value.slice(to)}`,
    selectionStart: from + marker.length,
    selectionEnd: from + marker.length + placeholder.length,
  };
}

export type PendingLinkPreview = LinkPreview | null;
