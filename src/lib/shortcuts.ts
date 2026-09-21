/** Slack-style keyboard shortcut registry for Relay. */

export type ShortcutAction =
  | 'open-shortcuts'
  | 'open-palette'
  | 'prev-channel'
  | 'next-channel'
  | 'prev-unread'
  | 'next-unread'
  | 'focus-composer'
  | 'mark-unread'
  | 'open-unreads'
  | 'open-threads'
  | 'open-later'
  | 'open-activity'
  | 'open-drafts';

export type ShortcutDef = {
  id: string;
  action: ShortcutAction;
  /** Keys shown in the help modal, e.g. ['⌥', '↑'] */
  keys: string[];
  /** Human label */
  label: string;
  group: 'Navigation' | 'Messaging' | 'Views' | 'General';
  /** Match against KeyboardEvent */
  match: (event: KeyboardEvent, mod: boolean) => boolean;
};

export function isMacPlatform() {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
  );
}

export function modSymbol() {
  return isMacPlatform() ? '⌘' : 'Ctrl';
}

export function altSymbol() {
  return isMacPlatform() ? '⌥' : 'Alt';
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable="true"]')) return true;
  if (target.closest('[role="textbox"]')) return true;
  return false;
}

function keyOf(event: KeyboardEvent) {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'open-shortcuts',
    action: 'open-shortcuts',
    keys: [modSymbol(), '/'],
    label: 'Keyboard shortcuts',
    group: 'General',
    match: (event, mod) =>
      (mod && event.key === '/') ||
      (!mod &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === '?' &&
        !isTypingTarget(event.target)),
  },
  {
    id: 'open-palette',
    action: 'open-palette',
    keys: [modSymbol(), 'K'],
    label: 'Open command palette',
    group: 'General',
    match: (event, mod) => mod && keyOf(event) === 'k',
  },
  {
    id: 'prev-channel',
    action: 'prev-channel',
    keys: [altSymbol(), '↑'],
    label: 'Previous channel / DM',
    group: 'Navigation',
    match: (event) =>
      event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      event.key === 'ArrowUp',
  },
  {
    id: 'next-channel',
    action: 'next-channel',
    keys: [altSymbol(), '↓'],
    label: 'Next channel / DM',
    group: 'Navigation',
    match: (event) =>
      event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      event.key === 'ArrowDown',
  },
  {
    id: 'prev-unread',
    action: 'prev-unread',
    keys: [altSymbol(), '⇧', '↑'],
    label: 'Previous unread',
    group: 'Navigation',
    match: (event) =>
      event.altKey &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      event.key === 'ArrowUp',
  },
  {
    id: 'next-unread',
    action: 'next-unread',
    keys: [altSymbol(), '⇧', '↓'],
    label: 'Next unread',
    group: 'Navigation',
    match: (event) =>
      event.altKey &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      event.key === 'ArrowDown',
  },
  {
    id: 'focus-composer',
    action: 'focus-composer',
    keys: ['C'],
    label: 'Focus message composer',
    group: 'Messaging',
    match: (event) =>
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      keyOf(event) === 'c' &&
      !isTypingTarget(event.target),
  },
  {
    id: 'mark-unread',
    action: 'mark-unread',
    keys: ['U'],
    label: 'Mark conversation unread',
    group: 'Messaging',
    match: (event) =>
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      keyOf(event) === 'u' &&
      !isTypingTarget(event.target),
  },
  {
    id: 'open-unreads',
    action: 'open-unreads',
    keys: [modSymbol(), '⇧', 'U'],
    label: 'Open Unreads',
    group: 'Views',
    match: (event, mod) => mod && event.shiftKey && keyOf(event) === 'u',
  },
  {
    id: 'open-threads',
    action: 'open-threads',
    keys: [modSymbol(), '⇧', 'T'],
    label: 'Open Threads',
    group: 'Views',
    match: (event, mod) => mod && event.shiftKey && keyOf(event) === 't',
  },
  {
    id: 'open-later',
    action: 'open-later',
    keys: [modSymbol(), '⇧', 'L'],
    label: 'Open Later',
    group: 'Views',
    match: (event, mod) => mod && event.shiftKey && keyOf(event) === 'l',
  },
  {
    id: 'open-activity',
    action: 'open-activity',
    keys: [modSymbol(), '⇧', 'A'],
    label: 'Open Activity',
    group: 'Views',
    match: (event, mod) => mod && event.shiftKey && keyOf(event) === 'a',
  },
  {
    id: 'open-drafts',
    action: 'open-drafts',
    keys: [modSymbol(), '⇧', 'D'],
    label: 'Open Drafts',
    group: 'Views',
    match: (event, mod) => mod && event.shiftKey && keyOf(event) === 'd',
  },
];

export function matchShortcut(event: KeyboardEvent): ShortcutDef | null {
  const mod = event.metaKey || event.ctrlKey;
  for (const item of SHORTCUTS) {
    if (item.match(event, mod)) return item;
  }
  return null;
}

export function dispatchShortcutAction(action: ShortcutAction) {
  if (action === 'open-shortcuts') {
    window.dispatchEvent(new CustomEvent('relay:open-shortcuts'));
    return;
  }
  if (action === 'open-palette') {
    window.dispatchEvent(new CustomEvent('relay:open-command-palette'));
    return;
  }
  window.dispatchEvent(
    new CustomEvent('relay:command', { detail: { action } }),
  );
}
