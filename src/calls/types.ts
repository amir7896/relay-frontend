/** Shared voice/video-call types (signaling over Socket.IO, media via WebRTC mesh). */

export type CallPhase =
  | 'idle'
  | 'outgoing'
  | 'incoming'
  | 'connecting'
  | 'active'
  | 'ended';

export type CallKind = 'private' | 'group';
export type CallMedia = 'audio' | 'video';
export type CallMode = 'ring' | 'huddle';

export type CallEndReason =
  | 'hangup'
  | 'rejected'
  | 'timeout'
  | 'offline'
  | 'error'
  | 'busy'
  | 'removed';

export type NetworkQuality = 'good' | 'fair' | 'poor' | 'unknown';

export type CallParticipantStatus = 'joined' | 'ringing' | 'declined' | 'left';

export type VoiceCallInfo = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  media: CallMedia;
  mode?: CallMode;
  /** Primary peer for private UI; host for incoming group. */
  peerUserId: string;
  memberIds: string[];
  joinedIds: string[];
  direction: 'outgoing' | 'incoming';
  hostId?: string;
};

export type CallInviteAck = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  media?: CallMedia;
  mode?: CallMode;
  peerIds: string[];
  memberIds: string[];
  joinedIds: string[];
  status: string;
};

export type CallIncomingEvent = {
  callId: string;
  conversationId: string;
  fromUserId: string;
  kind?: CallKind;
  media?: CallMedia;
  mode?: CallMode;
  memberIds?: string[];
  joinedIds?: string[];
};

export type CallParticipantEvent = {
  callId: string;
  conversationId: string;
  kind?: CallKind;
  byUserId: string;
  joinedIds: string[];
  memberIds?: string[];
};

export type CallAcceptedEvent = CallParticipantEvent;

export type CallEndedEvent = {
  callId: string;
  conversationId: string;
  byUserId: string;
  reason: CallEndReason;
};

export type CallSdpEvent = {
  callId: string;
  fromUserId: string;
  toUserId?: string;
  sdp: RTCSessionDescriptionInit;
};

export type CallIceEvent = {
  callId: string;
  fromUserId: string;
  toUserId?: string;
  candidate: RTCIceCandidateInit | null;
};

export type CallLobbyInfo = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  media?: CallMedia;
  mode?: CallMode;
  hostId: string;
  memberIds: string[];
  joinedIds: string[];
  declinedIds?: string[];
  leftIds?: string[];
  ringingIds?: string[];
  onHold?: boolean;
  heldBy?: string | null;
  forceMuted?: boolean;
  screenSharerId?: string | null;
  active: boolean;
};

export type CallRosterInfo = {
  callId: string;
  conversationId: string;
  hostId: string;
  joinedIds: string[];
  ringingIds: string[];
  declinedIds: string[];
  leftIds: string[];
  memberIds: string[];
  onHold: boolean;
  heldBy: string | null;
  forceMuted: boolean;
  screenSharerId: string | null;
};

export type CallHeldEvent = {
  callId: string;
  conversationId: string;
  onHold: boolean;
  heldBy: string | null;
  byUserId: string;
};

export type CallForceMuteEvent = {
  callId: string;
  conversationId: string;
  muted: boolean;
  byUserId: string;
};

export type CallScreenShareEvent = {
  callId: string;
  conversationId: string;
  active: boolean;
  byUserId: string;
};

export type CallDeclinedEvent = {
  callId: string;
  conversationId: string;
  byUserId: string;
};

/** Parsed body for MessageType.CALL history rows. */
export type CallHistoryBody = {
  v: number;
  callId: string;
  kind: CallKind;
  media: CallMedia;
  outcome: 'completed' | 'missed' | 'declined' | 'cancelled';
  durationSeconds: number;
  reason?: string;
  byUserId?: string;
};

export function parseCallHistoryBody(raw: string): CallHistoryBody | null {
  try {
    const parsed = JSON.parse(raw) as CallHistoryBody;
    if (!parsed || typeof parsed !== 'object' || !parsed.callId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function formatCallDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function callHistoryLabel(body: CallHistoryBody): string {
  const media = body.media === 'video' ? 'Video' : 'Voice';
  const group = body.kind === 'group' ? 'Group ' : '';
  if (body.outcome === 'missed') {
    return `Missed ${group.toLowerCase()}${media.toLowerCase()} call`;
  }
  if (body.outcome === 'declined') {
    return `${group}${media} call declined`;
  }
  if (body.outcome === 'cancelled') {
    return `${group}${media} call cancelled`;
  }
  if (body.durationSeconds > 0) {
    return `${group}${media} call · ${formatCallDuration(body.durationSeconds)}`;
  }
  return `${group}${media} call`;
}

export function lobbyToRoster(lobby: CallLobbyInfo): CallRosterInfo {
  return {
    callId: lobby.callId,
    conversationId: lobby.conversationId,
    hostId: lobby.hostId,
    joinedIds: lobby.joinedIds,
    ringingIds: lobby.ringingIds ?? [],
    declinedIds: lobby.declinedIds ?? [],
    leftIds: lobby.leftIds ?? [],
    memberIds: lobby.memberIds,
    onHold: Boolean(lobby.onHold),
    heldBy: lobby.heldBy ?? null,
    forceMuted: Boolean(lobby.forceMuted),
    screenSharerId: lobby.screenSharerId ?? null,
  };
}
