/** Derive WhatsApp-style participant rows from call roster state. */

import type { CallParticipantStatus, CallRosterInfo } from './types';

export type CallParticipantRow = {
  userId: string;
  status: CallParticipantStatus;
  isHost: boolean;
};

/**
 * Prefer explicit status buckets; fall back to joined-only when roster is thin.
 */
export function buildParticipantRows(
  roster: CallRosterInfo | null,
  fallback?: {
    memberIds: string[];
    joinedIds: string[];
    hostId?: string;
  },
): CallParticipantRow[] {
  const hostId = roster?.hostId ?? fallback?.hostId;
  const joined = new Set(roster?.joinedIds ?? fallback?.joinedIds ?? []);
  const ringing = new Set(roster?.ringingIds ?? []);
  const declined = new Set(roster?.declinedIds ?? []);
  const left = new Set(roster?.leftIds ?? []);
  const members = [
    ...new Set([
      ...(roster?.memberIds ?? fallback?.memberIds ?? []),
      ...joined,
      ...ringing,
      ...declined,
      ...left,
    ]),
  ];

  const order: CallParticipantStatus[] = [
    'joined',
    'ringing',
    'declined',
    'left',
  ];

  const statusOf = (userId: string): CallParticipantStatus => {
    if (joined.has(userId)) {
      return 'joined';
    }
    if (ringing.has(userId)) {
      return 'ringing';
    }
    if (declined.has(userId)) {
      return 'declined';
    }
    if (left.has(userId)) {
      return 'left';
    }
    return 'ringing';
  };

  return members
    .map((userId) => ({
      userId,
      status: statusOf(userId),
      isHost: Boolean(hostId && userId === hostId),
    }))
    .sort((a, b) => {
      const rank = order.indexOf(a.status) - order.indexOf(b.status);
      if (rank !== 0) {
        return rank;
      }
      if (a.isHost !== b.isHost) {
        return a.isHost ? -1 : 1;
      }
      return a.userId.localeCompare(b.userId);
    });
}

export function participantStatusLabel(status: CallParticipantStatus): string {
  switch (status) {
    case 'joined':
      return 'In call';
    case 'ringing':
      return 'Ringing…';
    case 'declined':
      return 'Declined';
    case 'left':
      return 'Left';
    default:
      return '';
  }
}
