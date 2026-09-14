import type { Conversation, UserProfile } from '../api/types';

export function displayName(
  person?: Pick<UserProfile, 'firstName' | 'lastName' | 'email'> | null,
) {
  if (!person) {
    return 'Unknown contact';
  }
  const name = `${person.firstName} ${person.lastName}`.trim();
  return name || person.email || 'Unknown contact';
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return value.slice(0, 2).toUpperCase();
}

export function relativeTime(value: string | null): string {
  if (!value) {
    return '';
  }
  const then = new Date(value).getTime();
  const delta = Date.now() - then;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function clock(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** WhatsApp-style inbox timestamp (today → time, yesterday → Yesterday, else short date). */
export function inboxTime(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) {
    return '';
  }
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const dayDiff = Math.round(
    (startToday.getTime() - startThen.getTime()) / 86_400_000,
  );
  if (dayDiff === 0) {
    return then.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  if (dayDiff === 1) {
    return 'Yesterday';
  }
  if (dayDiff < 7) {
    return then.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function formatLastSeen(
  lastSeenAt: string | null,
  status: 'online' | 'offline',
): string {
  if (status === 'online') {
    return 'Online';
  }
  if (!lastSeenAt) {
    return 'last seen recently';
  }
  const then = new Date(lastSeenAt);
  if (Number.isNaN(then.getTime())) {
    return 'last seen recently';
  }
  const now = new Date();
  const time = then.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) {
    return `last seen today at ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate();
  if (wasYesterday) {
    return `last seen yesterday at ${time}`;
  }
  const date = then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `last seen ${date} at ${time}`;
}

export function otherMember(conversation: Conversation, me?: string) {
  return (
    conversation.members.find((member) => member.userId !== me) ??
    conversation.members[0]
  );
}

export function conversationTitle(
  conversation: Conversation,
  me?: string,
  peopleById?: Map<string, UserProfile>,
): string {
  if (conversation.type === 'group') {
    const name = conversation.name?.trim() || 'channel';
    return name.startsWith('#') ? name : `#${name}`;
  }
  const peer = otherMember(conversation, me);
  if (!peer) {
    return 'Direct message';
  }
  return displayName(peopleById?.get(peer.userId));
}
