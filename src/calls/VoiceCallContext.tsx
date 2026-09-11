import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { useChatSocket } from '../chat/ChatSocketContext';
import { loadIceServers } from './iceServers';
import {
  playCallConnectedChime,
  playCallEndedChime,
  startCallRingtone,
  stopCallRingtone,
  unlockCallAudio,
} from './callRingtone';
import {
  applySinkId,
  listAudioOutputs,
  pickPreferredOutput,
  subscribeDeviceChanges,
  type AudioOutputDevice,
} from './callAudioRoute';
import {
  applyVoiceClarity,
  audioConstraintsForMode,
  type VoiceClarityMode,
} from './callVoiceClarity';
import { openCallPip, supportsDocumentPip, type CallPipHandle } from './callPip';
import type {
  CallAcceptedEvent,
  CallDeclinedEvent,
  CallEndReason,
  CallEndedEvent,
  CallForceMuteEvent,
  CallHeldEvent,
  CallIceEvent,
  CallIncomingEvent,
  CallInviteAck,
  CallLobbyInfo,
  CallMedia,
  CallParticipantEvent,
  CallPhase,
  CallRosterInfo,
  CallScreenShareEvent,
  CallSdpEvent,
  NetworkQuality,
  VoiceCallInfo,
} from './types';
import { lobbyToRoster } from './types';
import { VoicePeer } from './webrtcPeer';

type CallConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

type VoiceCallContextValue = {
  phase: CallPhase;
  call: VoiceCallInfo | null;
  muted: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  onHold: boolean;
  forceMuted: boolean;
  voiceClarity: VoiceClarityMode;
  roster: CallRosterInfo | null;
  screenSharerId: string | null;
  minimized: boolean;
  pipActive: boolean;
  supportsPip: boolean;
  remoteSpeaking: boolean;
  speakingPeerIds: string[];
  connectionState: CallConnectionState;
  networkQuality: NetworkQuality;
  networkHint: string;
  error: string;
  elapsedSeconds: number;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  audioOutputId: string;
  audioOutputs: AudioOutputDevice[];
  /** Live group-call lobbies keyed by conversationId (for Join / rejoin). */
  lobbiesByConversation: Record<string, CallLobbyInfo>;
  startCall: (
    conversationId: string,
    peerUserId?: string,
    media?: CallMedia,
  ) => Promise<void>;
  joinCall: (conversationId: string, withVideo?: boolean) => Promise<void>;
  refreshLobby: (conversationId: string) => Promise<void>;
  acceptCall: (withVideo?: boolean) => Promise<void>;
  rejectCall: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => Promise<void>;
  switchCamera: () => Promise<void>;
  toggleHold: () => Promise<void>;
  toggleMuteAll: () => Promise<void>;
  inviteParticipants: (userIds: string[]) => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  setVoiceClarity: (mode: VoiceClarityMode) => Promise<void>;
  setAudioOutput: (deviceId: string) => Promise<void>;
  refreshAudioOutputs: () => Promise<void>;
  setMinimized: (value: boolean) => void;
  enterPip: () => Promise<void>;
  exitPip: () => void;
};

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);

function socketErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown };
    if (typeof maybe.message === 'string' && maybe.message.trim()) {
      return maybe.message;
    }
  }
  return fallback;
}

function isBenignWebrtcStateError(message: string): boolean {
  return /skip-offer|wrong state|stable|rollback|setLocalDescription|setRemoteDescription/i.test(
    message,
  );
}

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const me = session?.user.id;
  const { subscribe, emitAck, connected } = useChatSocket();

  const [phase, setPhase] = useState<CallPhase>('idle');
  const [call, setCall] = useState<VoiceCallInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [forceMuted, setForceMuted] = useState(false);
  const [voiceClarity, setVoiceClarityState] = useState<VoiceClarityMode>('standard');
  const [roster, setRoster] = useState<CallRosterInfo | null>(null);
  const [screenSharerId, setScreenSharerId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const [speakingPeerIds, setSpeakingPeerIds] = useState<string[]>([]);
  const [connectionState, setConnectionState] =
    useState<CallConnectionState>('idle');
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>('unknown');
  const [networkHint, setNetworkHint] = useState('');
  const [error, setError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>(
    {},
  );
  const [audioOutputId, setAudioOutputId] = useState('default');
  const [audioOutputs, setAudioOutputs] = useState<AudioOutputDevice[]>([]);
  const [lobbiesByConversation, setLobbiesByConversation] = useState<
    Record<string, CallLobbyInfo>
  >({});

  const peersRef = useRef<Map<string, VoicePeer>>(new Map());
  /** Prevents duplicate RTCPeerConnections when offer + join race on mobile. */
  const peerCreateInflightRef = useRef<Map<string, Promise<VoicePeer>>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioElements = useRef<Map<string, HTMLAudioElement>>(new Map());
  const callRef = useRef<VoiceCallInfo | null>(null);
  const phaseRef = useRef<CallPhase>('idle');
  const activeStartedAtRef = useRef<number | null>(null);
  const speakingMonitorsRef = useRef<Map<string, { stop: () => void }>>(new Map());
  /** Shared AudioContext for speaking detection (one per call, not per peer). */
  const speakingAudioCtxRef = useRef<AudioContext | null>(null);
  const vibrateTimerRef = useRef<number | null>(null);
  const iceServersRef = useRef<RTCIceServer[] | null>(null);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const audioOutputIdRef = useRef('default');
  const wantVideoRef = useRef(false);
  const voiceClarityRef = useRef<VoiceClarityMode>('standard');
  const forceMutedRef = useRef(false);
  const onHoldRef = useRef(false);
  const pipRef = useRef<CallPipHandle | null>(null);
  const mutedBeforeForceRef = useRef(false);
  const cameraOnBeforeShareRef = useRef(false);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const unlock = () => {
      void unlockCallAudio();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    const stopVibrate = () => {
      if (vibrateTimerRef.current != null) {
        window.clearInterval(vibrateTimerRef.current);
        vibrateTimerRef.current = null;
      }
      navigator.vibrate?.(0);
    };

    if (phase === 'incoming') {
      void unlockCallAudio().then(() => startCallRingtone('incoming'));
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate([220, 120, 220, 120, 220]);
        vibrateTimerRef.current = window.setInterval(() => {
          navigator.vibrate?.([220, 120, 220, 120, 220]);
        }, 2400);
      }
      return () => {
        stopCallRingtone();
        stopVibrate();
      };
    }
    if (phase === 'outgoing') {
      void unlockCallAudio().then(() => startCallRingtone('outgoing'));
      return () => stopCallRingtone();
    }
    stopCallRingtone();
    stopVibrate();
    if (phase === 'active') {
      playCallConnectedChime();
    }
    if (phase === 'ended') {
      playCallEndedChime();
    }
    return undefined;
  }, [phase]);

  useEffect(() => {
    return () => {
      stopCallRingtone();
      speakingMonitorsRef.current.forEach((monitor) => monitor.stop());
      speakingMonitorsRef.current.clear();
      navigator.vibrate?.(0);
    };
  }, []);

  useEffect(() => {
    if (phase === 'idle') {
      setMinimized(false);
      setConnectionState('idle');
      setRemoteSpeaking(false);
      setSpeakingPeerIds([]);
    }
  }, [phase]);

  useEffect(() => {
    if (phase === 'connecting') {
      setConnectionState('connecting');
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== 'active') {
      activeStartedAtRef.current = null;
      setElapsedSeconds(0);
      return;
    }
    activeStartedAtRef.current = Date.now();
    const timer = window.setInterval(() => {
      const started = activeStartedAtRef.current;
      if (!started) {
        return;
      }
      setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const stopSpeakingMonitor = useCallback((peerId?: string) => {
    if (peerId) {
      speakingMonitorsRef.current.get(peerId)?.stop();
      speakingMonitorsRef.current.delete(peerId);
      setSpeakingPeerIds((current) => current.filter((id) => id !== peerId));
      if (speakingMonitorsRef.current.size === 0) {
        void speakingAudioCtxRef.current?.close().catch(() => undefined);
        speakingAudioCtxRef.current = null;
      }
      return;
    }
    speakingMonitorsRef.current.forEach((monitor) => monitor.stop());
    speakingMonitorsRef.current.clear();
    void speakingAudioCtxRef.current?.close().catch(() => undefined);
    speakingAudioCtxRef.current = null;
    setSpeakingPeerIds([]);
    setRemoteSpeaking(false);
  }, []);

  const startSpeakingMonitor = useCallback(
    (peerId: string, stream: MediaStream) => {
      stopSpeakingMonitor(peerId);
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctx) {
          return;
        }
        if (!speakingAudioCtxRef.current) {
          speakingAudioCtxRef.current = new Ctx();
        }
        const ctx = speakingAudioCtxRef.current;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let alive = true;
        let speaking = false;

        const tick = () => {
          if (!alive) {
            return;
          }
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            sum += data[i];
          }
          const next = sum / data.length > 18;
          if (next !== speaking) {
            speaking = next;
            setSpeakingPeerIds((current) => {
              const has = current.includes(peerId);
              if (next && !has) {
                return [...current, peerId];
              }
              if (!next && has) {
                return current.filter((id) => id !== peerId);
              }
              return current;
            });
          }
          window.setTimeout(tick, 200);
        };
        tick();
        speakingMonitorsRef.current.set(peerId, {
          stop: () => {
            alive = false;
            try {
              source.disconnect();
              analyser.disconnect();
            } catch {
              // already disconnected
            }
          },
        });
      } catch {
        // Analyser unsupported
      }
    },
    [stopSpeakingMonitor],
  );

  useEffect(() => {
    setRemoteSpeaking(speakingPeerIds.length > 0);
  }, [speakingPeerIds]);

  const attachRemoteAudio = useCallback((peerId: string, stream: MediaStream) => {
    let audio = remoteAudioElements.current.get(peerId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      remoteAudioElements.current.set(peerId, audio);
    }
    audio.srcObject = stream;
    audio.muted = onHoldRef.current;
    void applySinkId([audio], audioOutputIdRef.current);
    if (!onHoldRef.current) {
      void audio.play().catch(() => undefined);
    }
    startSpeakingMonitor(peerId, stream);

    const publish = () => {
      // New MediaStream identity forces React video tiles to remount/bind
      setRemoteStreams((current) => ({
        ...current,
        [peerId]: new MediaStream(stream.getTracks()),
      }));
    };
    publish();
    stream.addEventListener('addtrack', publish);
    stream.addEventListener('removetrack', publish);
    stream.getTracks().forEach((track) => {
      track.addEventListener('unmute', publish);
      track.addEventListener('mute', publish);
      track.addEventListener('ended', publish);
    });
  }, [startSpeakingMonitor]);

  const closePeer = useCallback(
    (peerId: string) => {
      peerCreateInflightRef.current.delete(peerId);
      const peer = peersRef.current.get(peerId);
      peer?.close({ stopLocal: false });
      peersRef.current.delete(peerId);
      stopSpeakingMonitor(peerId);
      const audio = remoteAudioElements.current.get(peerId);
      if (audio) {
        audio.srcObject = null;
        remoteAudioElements.current.delete(peerId);
      }
      setRemoteStreams((current) => {
        if (!(peerId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    },
    [stopSpeakingMonitor],
  );

  const cleanupMedia = useCallback(() => {
    stopSpeakingMonitor();
    peerCreateInflightRef.current.clear();
    peersRef.current.forEach((peer) => peer.close({ stopLocal: false }));
    peersRef.current.clear();
    remoteAudioElements.current.forEach((audio) => {
      audio.srcObject = null;
    });
    remoteAudioElements.current.clear();
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams({});
    setMuted(false);
    setCameraOn(false);
    setScreenSharing(false);
    setOnHold(false);
    setForceMuted(false);
    setVoiceClarityState('standard');
    setRoster(null);
    setScreenSharerId(null);
    setNetworkQuality('unknown');
    setNetworkHint('');
    wantVideoRef.current = false;
    voiceClarityRef.current = 'standard';
    forceMutedRef.current = false;
    onHoldRef.current = false;
    cameraOnBeforeShareRef.current = false;
    facingModeRef.current = 'user';
    pipRef.current?.close();
    pipRef.current = null;
    setPipActive(false);
  }, [stopSpeakingMonitor]);

  const applyHoldToMedia = useCallback((held: boolean) => {
    onHoldRef.current = held;
    setOnHold(held);
    const stream = localStreamRef.current;
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !held && !muted && !forceMutedRef.current;
    });
    stream?.getVideoTracks().forEach((track) => {
      track.enabled = !held && cameraOn;
    });
    remoteAudioElements.current.forEach((audio) => {
      audio.muted = held;
      if (held) {
        audio.pause();
      } else {
        void audio.play().catch(() => undefined);
      }
    });
  }, [cameraOn, muted]);

  const applyForceMuteLocal = useCallback((forced: boolean) => {
    forceMutedRef.current = forced;
    setForceMuted(forced);
    if (forced) {
      mutedBeforeForceRef.current = muted;
      setMuted(true);
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      return;
    }
    const restore = mutedBeforeForceRef.current;
    setMuted(restore);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !restore && !onHoldRef.current;
    });
  }, [muted]);

  const resetToIdle = useCallback(
    (reason?: CallEndReason | 'error', message?: string) => {
      cleanupMedia();
      setMinimized(false);
      setConnectionState(reason === 'error' ? 'failed' : 'idle');
      if (reason) {
        setPhase('ended');
        if (message) {
          setError(message);
        }
        window.setTimeout(() => {
          setCall(null);
          setPhase('idle');
          setError('');
          setConnectionState('idle');
        }, 1800);
        return;
      }
      setCall(null);
      setPhase('idle');
      setError('');
    },
    [cleanupMedia],
  );

  const ensureIceServers = useCallback(async () => {
    if (!iceServersRef.current) {
      iceServersRef.current = await loadIceServers();
    }
    return iceServersRef.current;
  }, []);

  const ensureLocalStream = useCallback(async (wantVideo = wantVideoRef.current) => {
    const existing = localStreamRef.current;
    if (existing) {
      const hasVideo = existing.getVideoTracks().length > 0;
      if (wantVideo && !hasVideo) {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingModeRef.current,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        videoStream.getVideoTracks().forEach((track) => {
          existing.addTrack(track);
        });
        setCameraOn(true);
        setLocalStream(new MediaStream(existing.getTracks()));
        return existing;
      }
      return existing;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraintsForMode(voiceClarityRef.current),
      video: wantVideo
        ? {
            facingMode: facingModeRef.current,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : false,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    setCameraOn(wantVideo && stream.getVideoTracks().length > 0);
    return stream;
  }, []);

  const getOrCreatePeer = useCallback(
    async (remoteUserId: string) => {
      const existing = peersRef.current.get(remoteUserId);
      if (existing) {
        return existing;
      }
      const inflight = peerCreateInflightRef.current.get(remoteUserId);
      if (inflight) {
        return inflight;
      }

      const createPromise = (async () => {
        const again = peersRef.current.get(remoteUserId);
        if (again) {
          return again;
        }
        const active = callRef.current;
        if (!active) {
          throw new Error('No active call');
        }
        const iceServers = await ensureIceServers();
        // Local camera is optional even on a video call (join as voice)
        const stream = await ensureLocalStream(wantVideoRef.current || cameraOn);
        const peer = new VoicePeer(iceServers, {
          onRemoteStream: (remote) => attachRemoteAudio(remoteUserId, remote),
          onIceCandidate: (candidate) => {
            void emitAck('call:ice', {
              callId: active.callId,
              toUserId: remoteUserId,
              candidate,
            }).catch(() => undefined);
          },
          onConnectionState: (state) => {
            if (state === 'connected') {
              setConnectionState('connected');
              setNetworkQuality('good');
              setNetworkHint('');
              setPhase((current) =>
                current === 'connecting' || current === 'outgoing'
                  ? 'active'
                  : current,
              );
            } else if (state === 'connecting' || state === 'new') {
              setConnectionState('connecting');
            } else if (state === 'disconnected') {
              setConnectionState('reconnecting');
              setNetworkQuality('poor');
              setNetworkHint('Reconnecting… Weak connection');
            } else if (state === 'failed') {
              closePeer(remoteUserId);
              if (peersRef.current.size === 0 && phaseRef.current === 'active') {
                setConnectionState('failed');
                setNetworkQuality('poor');
                setNetworkHint('Connection failed — try leaving and rejoining');
              }
            }
          },
          onIceConnectionState: (state) => {
            if (state === 'checking') {
              setNetworkHint('Connecting…');
            } else if (state === 'disconnected') {
              setConnectionState('reconnecting');
              setNetworkQuality('poor');
              setNetworkHint('Reconnecting…');
            } else if (state === 'failed') {
              setNetworkQuality('poor');
              setNetworkHint('Poor network — audio may drop');
            } else if (state === 'connected' || state === 'completed') {
              setNetworkHint('');
            }
          },
        });
        await peer.startLocalMedia(stream, {
          video: wantVideoRef.current || cameraOn,
        });
        peersRef.current.set(remoteUserId, peer);
        return peer;
      })();

      peerCreateInflightRef.current.set(remoteUserId, createPromise);
      try {
        return await createPromise;
      } finally {
        peerCreateInflightRef.current.delete(remoteUserId);
      }
    },
    [attachRemoteAudio, cameraOn, closePeer, emitAck, ensureIceServers, ensureLocalStream],
  );

  const offerToPeer = useCallback(
    async (remoteUserId: string) => {
      const active = callRef.current;
      if (!active || !me || remoteUserId === me) {
        return;
      }
      const peer = await getOrCreatePeer(remoteUserId);
      try {
        const offer = await peer.createOffer({ video: true });
        await emitAck('call:offer', {
          callId: active.callId,
          toUserId: remoteUserId,
          sdp: offer,
        });
      } catch (err) {
        const message = socketErrorMessage(err, 'Could not connect to participant');
        if (!isBenignWebrtcStateError(message)) {
          throw err;
        }
      }
    },
    [emitAck, getOrCreatePeer, me],
  );

  const upsertLobby = useCallback((lobby: CallLobbyInfo) => {
    setLobbiesByConversation((current) => {
      if (!lobby.active || lobby.joinedIds.length === 0) {
        if (!(lobby.conversationId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[lobby.conversationId];
        return next;
      }
      return {
        ...current,
        [lobby.conversationId]: lobby,
      };
    });
    if (callRef.current?.callId === lobby.callId && lobby.active) {
      setRoster(lobbyToRoster(lobby));
      setOnHold(Boolean(lobby.onHold));
      onHoldRef.current = Boolean(lobby.onHold);
      if (Boolean(lobby.forceMuted) !== forceMutedRef.current) {
        // Applied via force_mute event for mute side-effects; keep flag in sync
        forceMutedRef.current = Boolean(lobby.forceMuted);
        setForceMuted(Boolean(lobby.forceMuted));
      }
      setScreenSharerId(lobby.screenSharerId ?? null);
      setCall((current) =>
        current
          ? {
              ...current,
              memberIds: lobby.memberIds,
              joinedIds: lobby.joinedIds,
              hostId: lobby.hostId,
            }
          : current,
      );
    }
  }, []);

  const applyRoster = useCallback((next: CallRosterInfo) => {
    if (callRef.current && callRef.current.callId !== next.callId) {
      return;
    }
    setRoster(next);
    setOnHold(next.onHold);
    onHoldRef.current = next.onHold;
    setForceMuted(next.forceMuted);
    forceMutedRef.current = next.forceMuted;
    setScreenSharerId(next.screenSharerId);
    setCall((current) =>
      current
        ? {
            ...current,
            memberIds: next.memberIds,
            joinedIds: next.joinedIds,
            hostId: next.hostId,
          }
        : current,
    );
  }, []);

  const clearLobby = useCallback((conversationId: string) => {
    setLobbiesByConversation((current) => {
      if (!(conversationId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const startCall = useCallback(
    async (
      conversationId: string,
      peerUserId?: string,
      media: CallMedia = 'audio',
    ) => {
      if (!me) {
        setError('Sign in to place a call');
        return;
      }
      if (!connected) {
        setError('Realtime connection is offline');
        return;
      }
      if (phaseRef.current !== 'idle') {
        setError('You are already in a call');
        return;
      }

      setError('');
      setMinimized(false);
      wantVideoRef.current = media === 'video';

      try {
        await ensureLocalStream(media === 'video');
        const ack = await emitAck<CallInviteAck>('call:invite', {
          conversationId,
          media,
        });
        if (!ack?.callId) {
          throw new Error('Call could not be created');
        }
        const callMedia = ack.media === 'video' || media === 'video' ? 'video' : 'audio';
        const next: VoiceCallInfo = {
          callId: ack.callId,
          conversationId: ack.conversationId,
          kind: ack.kind,
          media: callMedia,
          peerUserId: ack.peerIds[0] || peerUserId || me,
          memberIds: ack.memberIds,
          joinedIds: ack.joinedIds,
          direction: 'outgoing',
          hostId: me,
        };
        setConnectionState('connecting');
        setPhase('outgoing');
        setCall(next);
        callRef.current = next;
        setRoster({
          callId: ack.callId,
          conversationId: ack.conversationId,
          hostId: me,
          joinedIds: ack.joinedIds,
          ringingIds: ack.memberIds.filter((id) => !ack.joinedIds.includes(id)),
          declinedIds: [],
          leftIds: [],
          memberIds: ack.memberIds,
          onHold: false,
          heldBy: null,
          forceMuted: false,
          screenSharerId: null,
        });
        if (ack.kind === 'group') {
          upsertLobby({
            callId: ack.callId,
            conversationId: ack.conversationId,
            kind: 'group',
            media: callMedia,
            hostId: me,
            memberIds: ack.memberIds,
            joinedIds: ack.joinedIds,
            active: true,
          });
        }
      } catch (err) {
        cleanupMedia();
        resetToIdle('busy', socketErrorMessage(err, 'Could not start call'));
      }
    },
    [cleanupMedia, connected, emitAck, ensureLocalStream, me, resetToIdle, upsertLobby],
  );

  const acceptCall = useCallback(async (withVideo = false) => {
    const active = callRef.current;
    if (!active?.callId || active.direction !== 'incoming') {
      return;
    }
    setError('');
    setPhase('connecting');
    // Receiver chooses: join with camera, or voice-only on a video invite
    const useVideo = withVideo && active.media === 'video';
    wantVideoRef.current = useVideo;
    try {
      await ensureLocalStream(useVideo);
      setCameraOn(useVideo);
      await emitAck('call:accept', { callId: active.callId });
    } catch (err) {
      resetToIdle('error', socketErrorMessage(err, 'Could not accept call'));
    }
  }, [emitAck, ensureLocalStream, resetToIdle]);

  const joinCall = useCallback(
    async (conversationId: string, withVideo = false) => {
      if (!me) {
        setError('Sign in to join a call');
        return;
      }
      if (!connected) {
        setError('Realtime connection is offline');
        return;
      }
      if (phaseRef.current !== 'idle') {
        setError('You are already in a call');
        return;
      }

      let lobby = lobbiesByConversation[conversationId];
      if (!lobby?.active || !lobby.callId) {
        try {
          const response = await api<CallLobbyInfo | null>(
            `/chat/conversations/${conversationId}/active-call`,
          );
          if (response.data?.active) {
            lobby = response.data;
            upsertLobby(response.data);
          }
        } catch {
          // fall through
        }
      }
      if (!lobby?.active || !lobby.callId) {
        setError('No active group call to join');
        return;
      }

      setError('');
      setMinimized(false);
      setConnectionState('connecting');
      setPhase('connecting');
      const sessionMedia = lobby.media === 'video' ? 'video' : 'audio';
      const useVideo = withVideo && sessionMedia === 'video';
      wantVideoRef.current = useVideo;
      const next: VoiceCallInfo = {
        callId: lobby.callId,
        conversationId: lobby.conversationId,
        kind: 'group',
        media: sessionMedia,
        peerUserId: lobby.hostId,
        memberIds: lobby.memberIds,
        joinedIds: lobby.joinedIds,
        direction: 'incoming',
        hostId: lobby.hostId,
      };
      setCall(next);
      callRef.current = next;

      try {
        await ensureLocalStream(useVideo);
        setCameraOn(useVideo);
        const payload = await emitAck<CallParticipantEvent>('call:accept', {
          callId: lobby.callId,
        });
        setCall((current) =>
          current
            ? {
                ...current,
                joinedIds: payload.joinedIds || [...current.joinedIds, me],
                memberIds: payload.memberIds || current.memberIds,
              }
            : current,
        );
        if (callRef.current) {
          callRef.current = {
            ...callRef.current,
            joinedIds: payload.joinedIds || [...callRef.current.joinedIds, me],
          };
        }
      } catch (err) {
        resetToIdle('error', socketErrorMessage(err, 'Could not join call'));
      }
    },
    [
      connected,
      emitAck,
      ensureLocalStream,
      lobbiesByConversation,
      me,
      resetToIdle,
      upsertLobby,
    ],
  );

  const refreshLobby = useCallback(
    async (conversationId: string) => {
      try {
        const response = await api<CallLobbyInfo | null>(
          `/chat/conversations/${conversationId}/active-call`,
        );
        if (response.data?.active && response.data.joinedIds.length > 0) {
          upsertLobby(response.data);
        } else {
          clearLobby(conversationId);
        }
      } catch {
        // Ignore — lobby updates still arrive over the socket
      }
    },
    [clearLobby, upsertLobby],
  );

  const rejectCall = useCallback(async () => {
    const active = callRef.current;
    if (!active?.callId) {
      resetToIdle();
      return;
    }
    const conversationId = active.conversationId;
    const isGroup = active.kind === 'group';
    try {
      const result = await emitAck<{
        ok: boolean;
        ended?: boolean;
        lobby?: CallLobbyInfo | null;
      }>('call:reject', { callId: active.callId });
      if (!result.ended && result.lobby) {
        upsertLobby(result.lobby);
      } else if (result.ended) {
        clearLobby(conversationId);
      }
    } catch {
      // Ignore
    }
    // For group declines, keep lobby so user can Join again (no "Call declined" flash)
    if (isGroup) {
      cleanupMedia();
      setCall(null);
      setPhase('idle');
      setError('');
      setMinimized(false);
      return;
    }
    resetToIdle('rejected');
  }, [cleanupMedia, clearLobby, emitAck, resetToIdle, upsertLobby]);

  const hangup = useCallback(async () => {
    const active = callRef.current;
    if (!active?.callId) {
      resetToIdle();
      return;
    }
    const conversationId = active.conversationId;
    const isGroup = active.kind === 'group';
    try {
      const result = await emitAck<{
        ok: boolean;
        ended?: boolean;
        lobby?: CallLobbyInfo | null;
      }>('call:hangup', { callId: active.callId });
      if (!result.ended && result.lobby) {
        upsertLobby(result.lobby);
      } else if (result.ended) {
        clearLobby(conversationId);
      }
    } catch {
      // Ignore
    }
    if (isGroup) {
      cleanupMedia();
      setCall(null);
      setPhase('idle');
      setError('');
      setMinimized(false);
      return;
    }
    resetToIdle('hangup');
  }, [cleanupMedia, clearLobby, emitAck, resetToIdle, upsertLobby]);

  const toggleMute = useCallback(() => {
    if (forceMutedRef.current) {
      setError('Host muted everyone — wait for unmute');
      return;
    }
    if (onHoldRef.current) {
      return;
    }
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const next = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const renegotiateAll = useCallback(async () => {
    const active = callRef.current;
    const stream = localStreamRef.current;
    if (!active || !stream || !me) {
      return;
    }
    for (const [peerId, peer] of peersRef.current) {
      if (peerId === me) {
        continue;
      }
      await peer.syncLocalTracks(stream);
      try {
        const offer = await peer.createOffer({ video: true });
        await emitAck('call:offer', {
          callId: active.callId,
          toUserId: peerId,
          sdp: offer,
        }).catch(() => undefined);
      } catch (err) {
        const message = socketErrorMessage(err, '');
        if (!isBenignWebrtcStateError(message)) {
          // Non-fatal for one peer during renegotiation
        }
      }
    }
  }, [emitAck, me]);

  const toggleCamera = useCallback(async () => {
    const active = callRef.current;
    if (!active || phaseRef.current === 'idle') {
      return;
    }
    try {
      if (!cameraOn) {
        wantVideoRef.current = true;
        await ensureLocalStream(true);
        setCameraOn(true);
        setCall((current) =>
          current ? { ...current, media: 'video' } : current,
        );
        if (callRef.current) {
          callRef.current = { ...callRef.current, media: 'video' };
        }
        await renegotiateAll();
        return;
      }
      wantVideoRef.current = false;
      const stream = localStreamRef.current;
      stream?.getVideoTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });
      setCameraOn(false);
      setLocalStream(
        localStreamRef.current
          ? new MediaStream(localStreamRef.current.getTracks())
          : null,
      );
      await renegotiateAll();
    } catch (err) {
      setError(socketErrorMessage(err, 'Could not toggle camera'));
    }
  }, [cameraOn, ensureLocalStream, renegotiateAll]);

  const switchCamera = useCallback(async () => {
    if (!cameraOn) {
      return;
    }
    facingModeRef.current =
      facingModeRef.current === 'user' ? 'environment' : 'user';
    const stream = localStreamRef.current;
    stream?.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingModeRef.current,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const base = localStreamRef.current ?? new MediaStream();
      videoStream.getVideoTracks().forEach((track) => base.addTrack(track));
      localStreamRef.current = base;
      setLocalStream(base);
      await renegotiateAll();
    } catch (err) {
      setError(socketErrorMessage(err, 'Could not switch camera'));
    }
  }, [cameraOn, renegotiateAll]);

  const toggleHold = useCallback(async () => {
    const active = callRef.current;
    if (!active?.callId || phaseRef.current === 'idle') {
      return;
    }
    const next = !onHoldRef.current;
    try {
      const result = await emitAck<
        CallHeldEvent & { status?: string; message?: string }
      >('call:hold', { callId: active.callId, onHold: next });
      if (result.status === 'error') {
        setError(result.message || 'Could not update hold');
        return;
      }
      applyHoldToMedia(Boolean(result.onHold));
    } catch (err) {
      setError(socketErrorMessage(err, 'Could not update hold'));
    }
  }, [applyHoldToMedia, emitAck]);

  const toggleMuteAll = useCallback(async () => {
    const active = callRef.current;
    if (!active?.callId || !me) {
      return;
    }
    const hostId = roster?.hostId ?? active.hostId ?? me;
    if (hostId !== me) {
      setError('Only the host can mute everyone');
      return;
    }
    const next = !forceMutedRef.current;
    try {
      const result = await emitAck<
        CallForceMuteEvent & { status?: string; message?: string }
      >('call:mute_all', { callId: active.callId, muted: next });
      if (result.status === 'error') {
        setError(result.message || 'Could not mute everyone');
        return;
      }
      forceMutedRef.current = Boolean(result.muted);
      setForceMuted(Boolean(result.muted));
    } catch (err) {
      setError(socketErrorMessage(err, 'Could not mute everyone'));
    }
  }, [emitAck, me, roster?.hostId]);

  const inviteParticipants = useCallback(
    async (userIds: string[]) => {
      const active = callRef.current;
      if (!active?.callId || active.kind !== 'group') {
        return;
      }
      try {
        const result = await emitAck<{
          ok?: boolean;
          status?: string;
          message?: string;
          invitedIds?: string[];
          roster?: CallRosterInfo;
        }>('call:invite_more', { callId: active.callId, userIds });
        if (result.status === 'error') {
          setError(result.message || 'Could not invite members');
          return;
        }
        if (result.roster) {
          applyRoster(result.roster);
        }
      } catch (err) {
        setError(socketErrorMessage(err, 'Could not invite members'));
      }
    },
    [applyRoster, emitAck],
  );

  const setVoiceClarity = useCallback(async (mode: VoiceClarityMode) => {
    voiceClarityRef.current = mode;
    setVoiceClarityState(mode);
    await applyVoiceClarity(localStreamRef.current, mode);
  }, []);

  const stopScreenShare = useCallback(async () => {
    const active = callRef.current;
    const restoreCamera = cameraOnBeforeShareRef.current;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);

    const stream = localStreamRef.current;
    stream?.getVideoTracks().forEach((track) => {
      stream.removeTrack(track);
      track.stop();
    });

    // Never force-enable camera after share — only restore if it was on before
    if (restoreCamera) {
      wantVideoRef.current = true;
      try {
        await ensureLocalStream(true);
        setCameraOn(true);
      } catch {
        wantVideoRef.current = false;
        setCameraOn(false);
        setLocalStream(
          localStreamRef.current
            ? new MediaStream(localStreamRef.current.getTracks())
            : null,
        );
      }
    } else {
      wantVideoRef.current = false;
      setCameraOn(false);
      setLocalStream(
        localStreamRef.current
          ? new MediaStream(localStreamRef.current.getTracks())
          : null,
      );
    }

    if (active?.callId) {
      await emitAck('call:screen_share', {
        callId: active.callId,
        active: false,
      }).catch(() => undefined);
    }
    await renegotiateAll();
  }, [emitAck, ensureLocalStream, renegotiateAll]);

  const toggleScreenShare = useCallback(async () => {
    const active = callRef.current;
    if (!active?.callId || phaseRef.current === 'idle') {
      return;
    }
    if (screenSharing) {
      await stopScreenShare();
      return;
    }

    // Mobile browsers do not support web screen capture (getDisplayMedia).
    // Chrome/Safari may expose a stub that always fails — detect early.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const mobileUa = /iPhone|iPad|iPod|Android/i.test(ua);
    const iPadOsDesktopUa =
      /Macintosh/i.test(ua) &&
      typeof navigator !== 'undefined' &&
      navigator.maxTouchPoints > 1;
    if (mobileUa || iPadOsDesktopUa) {
      setError(
        'Screen sharing isn’t available in mobile browsers. Open this call on a laptop or desktop to share your screen — phones can still view a shared screen.',
      );
      return;
    }

    if (!window.isSecureContext) {
      setError('Screen sharing requires HTTPS. Open the app over a secure link.');
      return;
    }

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== 'function') {
      setError(
        'Screen sharing is not supported in this browser. Use Chrome, Edge, or Firefox on a desktop/laptop.',
      );
      return;
    }
    try {
      const display = await mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      screenStreamRef.current = display;
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) {
        display.getTracks().forEach((track) => track.stop());
        setError('No screen track was returned');
        return;
      }
      screenTrack.contentHint = 'detail';
      screenTrack.onended = () => {
        void stopScreenShare();
      };
      cameraOnBeforeShareRef.current = cameraOn || wantVideoRef.current;
      const base = localStreamRef.current ?? new MediaStream();
      base.getVideoTracks().forEach((track) => {
        base.removeTrack(track);
        track.stop();
      });
      base.addTrack(screenTrack);
      localStreamRef.current = base;
      setLocalStream(new MediaStream(base.getTracks()));
      setScreenSharing(true);
      setCameraOn(false);
      if (active.media !== 'video') {
        setCall((current) =>
          current ? { ...current, media: 'video' } : current,
        );
        if (callRef.current) {
          callRef.current = { ...callRef.current, media: 'video' };
        }
      }
      await emitAck('call:screen_share', {
        callId: active.callId,
        active: true,
      });
      // Give the track a tick to become live before negotiating
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      await renegotiateAll();
    } catch (err) {
      const message = socketErrorMessage(err, 'Could not share screen');
      if (/not a function|undefined|getDisplayMedia/i.test(message)) {
        setError(
          'Screen sharing is not supported in this browser. Use a desktop Chrome, Edge, or Firefox window.',
        );
      } else if (/Permission|NotAllowed|denied|AbortError/i.test(message)) {
        setError(
          'Screen share was blocked or cancelled. On phones this is usually unsupported — try sharing from a laptop instead.',
        );
      } else {
        setError(message);
      }
    }
  }, [cameraOn, emitAck, renegotiateAll, screenSharing, stopScreenShare]);

  const exitPip = useCallback(() => {
    pipRef.current?.close();
    pipRef.current = null;
    setPipActive(false);
  }, []);

  const enterPip = useCallback(async () => {
    if (!supportsDocumentPip()) {
      setMinimized(true);
      return;
    }
    const handle = await openCallPip({ width: 300, height: 168 });
    if (!handle) {
      setMinimized(true);
      return;
    }
    pipRef.current = handle;
    setPipActive(true);
    setMinimized(true);
    handle.window.addEventListener('pagehide', () => {
      pipRef.current = null;
      setPipActive(false);
    });
  }, []);

  const refreshAudioOutputs = useCallback(async (autoRoute = false) => {
    try {
      const outputs = await listAudioOutputs();
      setAudioOutputs(outputs);
      if (autoRoute) {
        const preferred = pickPreferredOutput(outputs, audioOutputIdRef.current);
        if (preferred !== audioOutputIdRef.current) {
          audioOutputIdRef.current = preferred;
          setAudioOutputId(preferred);
          await applySinkId(remoteAudioElements.current.values(), preferred);
        }
      }
    } catch {
      // Permissions may block labels until media is active
    }
  }, []);

  const setAudioOutput = useCallback(async (deviceId: string) => {
    audioOutputIdRef.current = deviceId;
    setAudioOutputId(deviceId);
    await applySinkId(remoteAudioElements.current.values(), deviceId);
  }, []);

  useEffect(() => {
    return subscribeDeviceChanges(() => {
      if (phaseRef.current === 'active' || phaseRef.current === 'connecting') {
        void refreshAudioOutputs(true);
      }
    });
  }, [refreshAudioOutputs]);

  useEffect(() => {
    if (phase !== 'active' && phase !== 'connecting') {
      return;
    }
    void refreshAudioOutputs(true);
    const timer = window.setInterval(() => {
      void (async () => {
        let worstRtt = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        // Sample a few peers — full-mesh getStats every tick is expensive on mobile
        const peers = [...peersRef.current.values()].slice(0, 3);
        for (const peer of peers) {
          const report = await peer.getStats();
          if (!report) {
            continue;
          }
          report.forEach((stat) => {
            if (stat.type === 'candidate-pair' && (stat as { state?: string }).state === 'succeeded') {
              const rtt = Number((stat as { currentRoundTripTime?: number }).currentRoundTripTime ?? 0);
              worstRtt = Math.max(worstRtt, rtt);
            }
            if (stat.type === 'inbound-rtp' && (stat as { kind?: string }).kind === 'audio') {
              packetsLost += Number((stat as { packetsLost?: number }).packetsLost ?? 0);
              packetsReceived += Number((stat as { packetsReceived?: number }).packetsReceived ?? 0);
            }
          });
        }
        const lossRate =
          packetsReceived + packetsLost > 0
            ? packetsLost / (packetsReceived + packetsLost)
            : 0;
        if (connectionState === 'reconnecting') {
          setNetworkQuality('poor');
          setNetworkHint('Reconnecting…');
          return;
        }
        if (worstRtt > 0.45 || lossRate > 0.08) {
          setNetworkQuality('poor');
          setNetworkHint('Poor network — voice may stutter');
        } else if (worstRtt > 0.25 || lossRate > 0.03) {
          setNetworkQuality('fair');
          setNetworkHint('Unstable connection');
        } else if (peersRef.current.size > 0) {
          setNetworkQuality('good');
          if (connectionState === 'connected') {
            setNetworkHint('');
          }
        }
      })();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [connectionState, phase, refreshAudioOutputs]);

  useEffect(() => {
    if (!me) {
      return;
    }

    const unsubs = [
      subscribe('call:lobby', (payload) => {
        const lobby = payload as CallLobbyInfo;
        if (!lobby?.conversationId) {
          return;
        }
        upsertLobby(lobby);
      }),

      subscribe('call:incoming', (payload) => {
        const event = payload as CallIncomingEvent;
        if (!event?.callId) {
          return;
        }

        // Always keep Join banner in sync for group rings
        if (event.kind === 'group' && event.conversationId) {
          upsertLobby({
            callId: event.callId,
            conversationId: event.conversationId,
            kind: 'group',
            media: event.media === 'video' ? 'video' : 'audio',
            hostId: event.fromUserId,
            memberIds: event.memberIds || [event.fromUserId, me],
            joinedIds: event.joinedIds || [event.fromUserId],
            active: true,
          });
        }

        // Host also sits in the conversation room — ignore own invite echo
        if (event.fromUserId === me) {
          return;
        }

        // Already showing this ring (duplicate room delivery / re-push)
        if (
          callRef.current?.callId === event.callId &&
          (phaseRef.current === 'incoming' || phaseRef.current === 'outgoing')
        ) {
          return;
        }

        if (phaseRef.current !== 'idle') {
          // Busy on another call: for groups keep lobby (Join later); private → decline
          if (event.kind !== 'group') {
            void emitAck('call:reject', { callId: event.callId }).catch(
              () => undefined,
            );
          }
          return;
        }
        const media = event.media === 'video' ? 'video' : 'audio';
        // Don't open camera until the receiver picks video vs voice
        wantVideoRef.current = false;
        const next: VoiceCallInfo = {
          callId: event.callId,
          conversationId: event.conversationId,
          kind: event.kind || 'private',
          media,
          peerUserId: event.fromUserId,
          memberIds: event.memberIds || [event.fromUserId, me],
          joinedIds: event.joinedIds || [event.fromUserId],
          direction: 'incoming',
          hostId: event.fromUserId,
        };
        setError('');
        setMinimized(false);
        setConnectionState('connecting');
        setCall(next);
        callRef.current = next;
        setPhase('incoming');
      }),

      subscribe('call:participant_joined', (payload) => {
        const event = payload as CallParticipantEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }

        setCall((current) =>
          current
            ? {
                ...current,
                joinedIds: event.joinedIds,
                memberIds: event.memberIds || current.memberIds,
              }
            : current,
        );
        callRef.current = {
          ...(callRef.current as VoiceCallInfo),
          joinedIds: event.joinedIds,
          memberIds: event.memberIds || callRef.current!.memberIds,
        };

        // I already joined: send offer to the new participant
        if (
          event.byUserId !== me &&
          event.joinedIds.includes(me) &&
          phaseRef.current !== 'incoming'
        ) {
          setPhase((current) =>
            current === 'outgoing' || current === 'connecting'
              ? 'connecting'
              : current === 'idle'
                ? current
                : 'active',
          );
          void offerToPeer(event.byUserId).catch((err) => {
            const message = socketErrorMessage(
              err,
              'Could not connect to participant',
            );
            if (isBenignWebrtcStateError(message)) {
              return;
            }
            setError(message);
          });
        }

        // I just joined: wait for offers from others (they will offer to me)
        if (event.byUserId === me) {
          setPhase('connecting');
        }
      }),

      subscribe('call:accepted', (payload) => {
        // Mesh offers are driven only by call:participant_joined.
        // Handling both caused duplicate offer→answer and:
        // "setRemoteDescription … Called in wrong state: stable" (esp. on mobile).
        const event = payload as CallAcceptedEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        setCall((current) =>
          current
            ? {
                ...current,
                joinedIds: event.joinedIds || current.joinedIds,
                memberIds: event.memberIds || current.memberIds,
              }
            : current,
        );
      }),

      subscribe('call:offer', (payload) => {
        const event = payload as CallSdpEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        if (event.toUserId && event.toUserId !== me) {
          return;
        }
        void (async () => {
          try {
            const peer = await getOrCreatePeer(event.fromUserId);
            const answer = await peer.acceptOffer(event.sdp);
            // null = duplicate/glare ignored (avoids "wrong state: stable" on mobile)
            if (!answer) {
              return;
            }
            await emitAck('call:answer', {
              callId: active.callId,
              toUserId: event.fromUserId,
              sdp: answer,
            });
            setPhase('active');
            setConnectionState('connected');
          } catch (err) {
            const message = socketErrorMessage(err, 'Could not connect the call');
            if (isBenignWebrtcStateError(message)) {
              return;
            }
            setError(message);
          }
        })();
      }),

      subscribe('call:answer', (payload) => {
        const event = payload as CallSdpEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        if (event.toUserId && event.toUserId !== me) {
          return;
        }
        void (async () => {
          try {
            const peer = peersRef.current.get(event.fromUserId);
            if (!peer) {
              return;
            }
            await peer.acceptAnswer(event.sdp);
            setPhase('active');
            setConnectionState('connected');
          } catch (err) {
            const message = socketErrorMessage(err, 'Could not connect the call');
            if (isBenignWebrtcStateError(message)) {
              return;
            }
            setError(message);
          }
        })();
      }),

      subscribe('call:ice', (payload) => {
        const event = payload as CallIceEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        if (event.toUserId && event.toUserId !== me) {
          return;
        }
        void peersRef.current.get(event.fromUserId)?.addIceCandidate(event.candidate);
      }),

      subscribe('call:participant_left', (payload) => {
        const event = payload as CallParticipantEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        closePeer(event.byUserId);
        setCall((current) =>
          current ? { ...current, joinedIds: event.joinedIds } : current,
        );
        if (callRef.current) {
          callRef.current = { ...callRef.current, joinedIds: event.joinedIds };
        }
        setRoster((current) =>
          current && current.callId === event.callId
            ? {
                ...current,
                joinedIds: event.joinedIds,
                leftIds: [...new Set([...current.leftIds, event.byUserId])],
                ringingIds: current.ringingIds.filter((id) => id !== event.byUserId),
              }
            : current,
        );
      }),

      subscribe('call:declined', (payload) => {
        const event = payload as CallDeclinedEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        setRoster((current) =>
          current && current.callId === event.callId
            ? {
                ...current,
                declinedIds: [...new Set([...current.declinedIds, event.byUserId])],
                ringingIds: current.ringingIds.filter((id) => id !== event.byUserId),
              }
            : {
                callId: event.callId,
                conversationId: event.conversationId,
                hostId: active.hostId || active.peerUserId,
                joinedIds: active.joinedIds,
                ringingIds: active.memberIds.filter(
                  (id) =>
                    !active.joinedIds.includes(id) && id !== event.byUserId,
                ),
                declinedIds: [event.byUserId],
                leftIds: [],
                memberIds: active.memberIds,
                onHold: onHoldRef.current,
                heldBy: null,
                forceMuted: forceMutedRef.current,
                screenSharerId: null,
              },
        );
      }),

      subscribe('call:roster', (payload) => {
        const event = payload as CallRosterInfo;
        applyRoster(event);
      }),

      subscribe('call:held', (payload) => {
        const event = payload as CallHeldEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        applyHoldToMedia(event.onHold);
        setRoster((current) =>
          current && current.callId === event.callId
            ? { ...current, onHold: event.onHold, heldBy: event.heldBy }
            : current,
        );
      }),

      subscribe('call:force_mute', (payload) => {
        const event = payload as CallForceMuteEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId || !me) {
          return;
        }
        // Host issued mute-all — others must mute; host stays unmuted
        if (event.byUserId === me || active.hostId === me) {
          forceMutedRef.current = event.muted;
          setForceMuted(event.muted);
          return;
        }
        applyForceMuteLocal(event.muted);
      }),

      subscribe('call:screen_share', (payload) => {
        const event = payload as CallScreenShareEvent;
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        setScreenSharerId(event.active ? event.byUserId : null);
        if (event.byUserId === me) {
          setScreenSharing(event.active);
        }
      }),

      subscribe('call:ended', (payload) => {
        const event = payload as CallEndedEvent;
        clearLobby(event.conversationId);
        const active = callRef.current;
        if (!active || active.callId !== event.callId) {
          return;
        }
        const message =
          event.reason === 'removed'
            ? 'You were removed from this group'
            : event.reason === 'rejected'
              ? 'Call declined'
              : event.reason === 'timeout'
                ? 'No answer'
                : event.reason === 'offline'
                  ? 'Call ended — peer went offline'
                  : event.reason === 'busy'
                    ? 'User is busy'
                    : 'Call ended';
        resetToIdle(event.reason, message);
      }),

      subscribe('chat:removed_from_group', (payload) => {
        const event = payload as { conversationId?: string };
        if (!event?.conversationId) {
          return;
        }
        clearLobby(event.conversationId);
        const active = callRef.current;
        if (active?.conversationId === event.conversationId) {
          resetToIdle('removed', 'You were removed from this group');
        }
      }),
    ];

    return () => {
      unsubs.forEach((off) => off());
    };
  }, [
    applyForceMuteLocal,
    applyHoldToMedia,
    applyRoster,
    clearLobby,
    closePeer,
    emitAck,
    getOrCreatePeer,
    me,
    offerToPeer,
    resetToIdle,
    subscribe,
    upsertLobby,
  ]);

  const value = useMemo(
    () => ({
      phase,
      call,
      muted,
      cameraOn,
      screenSharing,
      onHold,
      forceMuted,
      voiceClarity,
      roster,
      screenSharerId,
      minimized,
      pipActive,
      supportsPip: supportsDocumentPip(),
      remoteSpeaking,
      speakingPeerIds,
      connectionState,
      networkQuality,
      networkHint,
      error,
      elapsedSeconds,
      localStream,
      remoteStreams,
      audioOutputId,
      audioOutputs,
      lobbiesByConversation,
      startCall,
      joinCall,
      refreshLobby,
      acceptCall,
      rejectCall,
      hangup,
      toggleMute,
      toggleCamera,
      switchCamera,
      toggleHold,
      toggleMuteAll,
      inviteParticipants,
      toggleScreenShare,
      setVoiceClarity,
      setAudioOutput,
      refreshAudioOutputs,
      setMinimized,
      enterPip,
      exitPip,
    }),
    [
      phase,
      call,
      muted,
      cameraOn,
      screenSharing,
      onHold,
      forceMuted,
      voiceClarity,
      roster,
      screenSharerId,
      minimized,
      pipActive,
      remoteSpeaking,
      speakingPeerIds,
      connectionState,
      networkQuality,
      networkHint,
      error,
      elapsedSeconds,
      localStream,
      remoteStreams,
      audioOutputId,
      audioOutputs,
      lobbiesByConversation,
      startCall,
      joinCall,
      refreshLobby,
      acceptCall,
      rejectCall,
      hangup,
      toggleMute,
      toggleCamera,
      switchCamera,
      toggleHold,
      toggleMuteAll,
      inviteParticipants,
      toggleScreenShare,
      setVoiceClarity,
      setAudioOutput,
      refreshAudioOutputs,
      enterPip,
      exitPip,
    ],
  );

  return (
    <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>
  );
}

export function useVoiceCall() {
  const context = useContext(VoiceCallContext);
  if (!context) {
    throw new Error('useVoiceCall must be used within VoiceCallProvider');
  }
  return context;
}
