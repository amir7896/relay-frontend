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
  special?: 'channel' | 'here' | 'usergroup';
  groupHandle?: string;
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
 * @channel / @here / @usergroup stay as special mention chips; remaining text gets mrkdwn-lite.
 */
export function renderMessageBody(
  body: string,
  mentionLabels: Map<string, string>,
  userGroupHandles: Set<string> = new Set(),
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
    } else if (userGroupHandles.has(token)) {
      mentionParts.push({
        type: 'mention',
        value: token,
        special: 'usergroup',
        groupHandle: token,
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

/** Canvas embed tokens stored inline in the plain-text body. */
export type CanvasBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'linkEmbed'; url: string }
  | { type: 'fileEmbed'; name: string; url: string; mime: string }
  | { type: 'divider' };

const CANVAS_EMBED_PATTERN =
  /\{\{(?:file:([^|{}]+)\|([^|{}]+)\|([^|{}]*)|link:([^{}]+))\}\}/g;

export function serializeLinkEmbed(url: string): string {
  return `{{link:${url.trim()}}}`;
}

export function serializeFileEmbed(file: {
  name: string;
  url: string;
  mime?: string;
}): string {
  const name = (file.name || 'file').replace(/[{}|]/g, '');
  const mime = (file.mime || 'application/octet-stream').replace(/[{}|]/g, '');
  return `{{file:${name}|${file.url.trim()}|${mime}}}`;
}

export function allUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? [];
  return [...new Set(matches)];
}

function parseTextCanvasBlocks(text: string): CanvasBlock[] {
  if (!text) return [];
  const blocks: CanvasBlock[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const joined = paragraph.join('\n').replace(/^\n+|\n+$/g, '');
    if (joined.trim().length || paragraph.some((line) => line.length > 0)) {
      if (joined.length) blocks.push({ type: 'paragraph', text: joined });
    }
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'divider' });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ type: 'bullet', text: bullet[1] });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/** Split canvas body into rich blocks (headings, lists, embeds, paragraphs). */
export function parseCanvasBody(body: string): CanvasBlock[] {
  if (!body) return [];
  const blocks: CanvasBlock[] = [];
  const pattern = new RegExp(CANVAS_EMBED_PATTERN.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match.index > lastIndex) {
      blocks.push(...parseTextCanvasBlocks(body.slice(lastIndex, match.index)));
    }
    if (match[4] !== undefined) {
      const url = match[4].trim();
      if (url) blocks.push({ type: 'linkEmbed', url });
    } else {
      blocks.push({
        type: 'fileEmbed',
        name: (match[1] || 'file').trim(),
        url: (match[2] || '').trim(),
        mime: (match[3] || 'application/octet-stream').trim(),
      });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) {
    blocks.push(...parseTextCanvasBlocks(body.slice(lastIndex)));
  }
  return blocks;
}

export function collectCanvasLinkUrls(body: string): string[] {
  const urls = new Set<string>();
  for (const block of parseCanvasBody(body)) {
    if (block.type === 'linkEmbed') urls.add(block.url);
  }
  for (const url of allUrls(body.replace(CANVAS_EMBED_PATTERN, ' '))) {
    urls.add(url);
  }
  return [...urls].slice(0, 8);
}

/** Prefix the current line (or each selected line) with a markdown-ish marker. */
export function prefixComposerLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const from = Math.max(0, Math.min(start, end, value.length));
  const to = Math.max(0, Math.min(Math.max(start, end), value.length));
  const lineStart = value.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const lineEndIdx = value.indexOf('\n', to);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const segment = value.slice(lineStart, lineEnd);
  const lines = segment.split('\n');
  const nextLines = lines.map((line) => {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
    if (prefix === '# ' && /^#{1,3}\s/.test(line)) {
      return `${prefix}${line.replace(/^#{1,3}\s+/, '')}`;
    }
    if (prefix === '- ' && /^[-*]\s+/.test(line)) {
      return line.replace(/^[-*]\s+/, '');
    }
    if (prefix === '1. ' && /^\d+\.\s+/.test(line)) {
      return line.replace(/^\d+\.\s+/, '');
    }
    if (prefix === '> ' && /^>\s?/.test(line)) {
      return line.replace(/^>\s?/, '');
    }
    return `${prefix}${line}`;
  });
  const nextSegment = nextLines.join('\n');
  return {
    value: `${value.slice(0, lineStart)}${nextSegment}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextSegment.length,
  };
}

export function insertComposerText(
  value: string,
  start: number,
  end: number,
  insert: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const from = Math.max(0, Math.min(start, end, value.length));
  const to = Math.max(0, Math.min(Math.max(start, end), value.length));
  const needsLeading =
    from > 0 && !/\s$/.test(value.slice(from - 1, from)) ? '\n' : '';
  const needsTrailing =
    to < value.length && !/^\s/.test(value.slice(to, to + 1)) ? '\n' : '';
  const chunk = `${needsLeading}${insert}${needsTrailing}`;
  return {
    value: `${value.slice(0, from)}${chunk}${value.slice(to)}`,
    selectionStart: from + chunk.length,
    selectionEnd: from + chunk.length,
  };
}
