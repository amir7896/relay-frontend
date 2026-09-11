import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useVoiceCall } from '../calls/VoiceCallContext';
import { VOICE_CLARITY_LABELS, type VoiceClarityMode } from '../calls/callVoiceClarity';
import { displayName, initials } from '../lib/format';
import { useDirectory } from '../people/useDirectory';
import { CallParticipantsPanel } from './CallParticipantsPanel';

function formatElapsed(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3 7.7 7.7 0 0 0 2.4.4 1.2 1.2 0 0 1 1.2 1.2V20a1.2 1.2 0 0 1-1.2 1.2A17.2 17.2 0 0 1 2.8 4 1.2 1.2 0 0 1 4 2.8h3.5A1.2 1.2 0 0 1 8.7 4a7.7 7.7 0 0 0 .4 2.4 1.2 1.2 0 0 1-.3 1.2z"
      />
    </svg>
  );
}

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {off ? (
        <path
          fill="currentColor"
          d="M19.1 17.3 6.7 4.9 5.3 6.3l4.2 4.2V12a2.5 2.5 0 0 0 3.2 2.4l1.3 1.3A4 4 0 0 1 8 12v-.4L6.6 10.2A5.5 5.5 0 0 0 11.5 17v2H9v2h6v-2h-2.5v-2a5.5 5.5 0 0 0 2.7-1.1l3.3 3.3zM12 3a2.5 2.5 0 0 0-2.5 2.5v3.1l5 5V5.5A2.5 2.5 0 0 0 12 3Z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11Z"
        />
      )}
    </svg>
  );
}

function CamIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {off ? (
        <path
          fill="currentColor"
          d="M3.3 2 2 3.3 5.7 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12c.3 0 .6-.1.9-.2L20.7 22 22 20.7 3.3 2zm13.4 14.7H4V9h3.7l9 9.7zM20 7.5 16 10V9a2 2 0 0 0-2-2h-2.2l2 2H14v2.2l6 6V7.5z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M17 10.5V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3.5l5 4v-11l-5 4z"
        />
      )}
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.3v7.4a4.5 4.5 0 0 0 2.5-3.7zM14 3.2v2.1a6.9 6.9 0 0 1 0 13.4v2.1A8.9 8.9 0 0 0 14 3.2z"
      />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8.1 9.9 12 13.8l3.9-3.9 1.4 1.4L12 16.6 6.7 11.3z"
      />
    </svg>
  );
}

function VideoTile({
  stream,
  muted = true,
  mirror,
  label,
  speaking,
  placeholder,
  className,
  objectFit = 'cover',
}: {
  stream?: MediaStream | null;
  /** Display tiles should stay muted — call audio uses separate elements. */
  muted?: boolean;
  mirror?: boolean;
  label: string;
  speaking?: boolean;
  placeholder: string;
  className?: string;
  objectFit?: 'cover' | 'contain';
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [trackEpoch, setTrackEpoch] = useState(0);

  useEffect(() => {
    if (!stream) {
      return;
    }
    const bump = () => setTrackEpoch((value) => value + 1);
    stream.addEventListener('addtrack', bump);
    stream.addEventListener('removetrack', bump);
    const tracks = stream.getTracks();
    tracks.forEach((track) => {
      track.addEventListener('unmute', bump);
      track.addEventListener('mute', bump);
      track.addEventListener('ended', bump);
    });
    return () => {
      stream.removeEventListener('addtrack', bump);
      stream.removeEventListener('removetrack', bump);
      tracks.forEach((track) => {
        track.removeEventListener('unmute', bump);
        track.removeEventListener('mute', bump);
        track.removeEventListener('ended', bump);
      });
    };
  }, [stream]);

  const hasVideo = Boolean(
    stream?.getVideoTracks().some((track) => track.readyState !== 'ended'),
  );

  useEffect(() => {
    const node = videoRef.current;
    if (!node) {
      return;
    }
    if (!stream || !hasVideo) {
      node.srcObject = null;
      return;
    }
    if (node.srcObject !== stream) {
      node.srcObject = stream;
    }
    node.muted = muted;
    const play = () => {
      void node.play().catch(() => undefined);
    };
    play();
    node.addEventListener('loadedmetadata', play);
    return () => node.removeEventListener('loadedmetadata', play);
  }, [stream, hasVideo, muted, trackEpoch]);

  return (
    <div
      className={`voice-call-video-tile${speaking ? ' speaking' : ''}${
        className ? ` ${className}` : ''
      }`}
    >
      <video
        ref={videoRef}
        className={mirror ? 'mirror' : undefined}
        style={{
          objectFit,
          display: hasVideo ? 'block' : 'none',
        }}
        autoPlay
        playsInline
        muted={muted}
      />
      {!hasVideo ? (
        <div className="voice-call-video-fallback">
          <span>{placeholder}</span>
        </div>
      ) : null}
      <span className="voice-call-video-label">{label}</span>
    </div>
  );
}

function isLikelyMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  // iOS / Android browsers do not implement usable getDisplayMedia for web apps.
  if (/iPhone|iPad|iPod|Android/i.test(ua)) {
    return true;
  }
  // iPadOS 13+ may report as Mac; treat touch Macs as mobile for share UX.
  if (
    /Macintosh/i.test(ua) &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
}

function supportsScreenShare(): boolean {
  try {
    if (typeof navigator === 'undefined' || !window.isSecureContext) {
      return false;
    }
    // Mobile browsers often expose the API stub, but capture always fails.
    // Treat phones/tablets as unsupported so we don't show a dead Share control.
    if (isLikelyMobileBrowser()) {
      return false;
    }
    return (
      Boolean(navigator.mediaDevices) &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function'
    );
  } catch {
    return false;
  }
}

const SCREEN_SHARE_UNSUPPORTED_HINT =
  'Screen sharing isn’t available in mobile browsers (Android Chrome, iOS Safari, etc.). Join the call from a laptop or desktop to share your screen.';

export function VoiceCallOverlay() {
  const { session } = useAuth();
  const me = session?.user.id;
  const {
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
    supportsPip,
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
  } = useVoiceCall();
  const { byUserId, ensureProfiles } = useDirectory();
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [clarityOpen, setClarityOpen] = useState(false);
  const [shareExpanded, setShareExpanded] = useState(false);
  const canShare = supportsScreenShare();

  useEffect(() => {
    if (call?.memberIds?.length) {
      void ensureProfiles(call.memberIds);
    } else if (call?.peerUserId) {
      void ensureProfiles([call.peerUserId]);
    }
  }, [call?.memberIds, call?.peerUserId, ensureProfiles]);

  useEffect(() => {
    if (phase === 'idle') {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (shareExpanded) {
          setShareExpanded(false);
          return;
        }
        if (!minimized && (phase === 'connecting' || phase === 'active')) {
          setMinimized(true);
          return;
        }
        if (phase === 'incoming') {
          void rejectCall();
        } else if (phase !== 'ended') {
          void hangup();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hangup, minimized, phase, rejectCall, setMinimized, shareExpanded]);

  useEffect(() => {
    if (!screenSharerId) {
      setShareExpanded(false);
    }
  }, [screenSharerId]);

  const isGroup = call?.kind === 'group';
  const isVideo = call?.media === 'video' || cameraOn || screenSharing;
  const screenShareStream =
    screenSharerId && me && screenSharerId === me
      ? localStream
      : screenSharerId
        ? remoteStreams[screenSharerId] ?? null
        : null;
  const showingShare = Boolean(screenSharerId);
  const joinedOthers = useMemo(() => {
    if (!call) {
      return [] as string[];
    }
    return call.joinedIds.filter((id) => id !== call.peerUserId || isGroup);
  }, [call, isGroup]);

  const peerProfile = call?.peerUserId
    ? byUserId.get(call.peerUserId)
    : undefined;

  const peerName = useMemo(() => {
    if (!call) {
      return 'Contact';
    }
    if (isGroup) {
      const count = Math.max(1, call.joinedIds.length);
      return `Group ${isVideo ? 'video' : 'call'} · ${count} in call`;
    }
    return displayName(peerProfile);
  }, [call, isGroup, isVideo, peerProfile]);

  const peerInitials = initials(
    isGroup ? 'Group' : peerName === 'Contact' ? 'C' : peerName,
  );
  const avatarUrl = !isGroup ? peerProfile?.avatar?.trim() || '' : '';

  const participantTiles = useMemo(() => {
    if (!call) {
      return [];
    }
    return call.joinedIds.map((userId) => {
      const profile = byUserId.get(userId);
      const name = displayName(profile);
      return {
        userId,
        name,
        initials: initials(name),
        avatar: profile?.avatar?.trim() || '',
        speaking: speakingPeerIds.includes(userId),
        stream: remoteStreams[userId] ?? null,
      };
    });
  }, [byUserId, call, remoteStreams, speakingPeerIds]);

  if (phase === 'idle') {
    return null;
  }

  const isIncoming = phase === 'incoming';
  const isOutgoing = phase === 'outgoing';
  const inCall = phase === 'connecting' || phase === 'active';
  const canMinimize = inCall || isOutgoing;
  const showMediaStage =
    (isVideo || showingShare) && (inCall || isOutgoing || showingShare);
  const shareLabel =
    screenSharerId === me
      ? 'Your screen'
      : screenSharerId
        ? `${displayName(byUserId.get(screenSharerId))}’s screen`
        : 'Shared screen';
  const showNetworkBanner =
    Boolean(networkHint) &&
    (phase === 'active' || phase === 'connecting') &&
    (networkQuality === 'poor' ||
      networkQuality === 'fair' ||
      connectionState === 'reconnecting' ||
      connectionState === 'failed');

  const statusText =
    onHold
      ? 'On hold'
      : phase === 'incoming'
        ? isGroup
          ? `Incoming group ${isVideo ? 'video' : 'voice'} call`
          : `Incoming ${isVideo ? 'video' : 'voice'} call`
        : phase === 'outgoing'
          ? isGroup
            ? 'Calling group…'
            : 'Ringing…'
          : phase === 'connecting' || connectionState === 'connecting'
            ? 'Connecting…'
            : connectionState === 'reconnecting'
              ? 'Reconnecting…'
              : phase === 'active'
                ? formatElapsed(elapsedSeconds)
                : error || 'Call ended';

  const isHost = Boolean(me && (roster?.hostId ?? call?.hostId) === me);

  if (minimized && phase !== 'ended') {
    return (
      <div
        className={`voice-call-mini${pipActive ? ' pip' : ''}`}
        role="dialog"
        aria-label="Call minimized"
      >
        <button
          type="button"
          className="voice-call-mini-main"
          onClick={() => {
            exitPip();
            setMinimized(false);
          }}
          aria-label="Expand call"
        >
          <span
            className={`voice-call-mini-avatar${remoteSpeaking ? ' speaking' : ''}`}
          >
            {avatarUrl ? <img src={avatarUrl} alt="" /> : peerInitials}
          </span>
          <span className="voice-call-mini-meta">
            <strong>{isGroup ? 'Group call' : peerName}</strong>
            <small>
              {onHold ? 'On hold' : statusText}
              {screenSharerId ? ' · Sharing screen' : ''}
            </small>
          </span>
        </button>
        <button
          type="button"
          className={`voice-call-round mute${muted || forceMuted ? ' active' : ''}`}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
          onClick={toggleMute}
          disabled={!inCall && !isOutgoing}
        >
          <MicIcon off={muted || forceMuted} />
        </button>
        <button
          type="button"
          className="voice-call-round end"
          aria-label="End call"
          onClick={() => void hangup()}
        >
          <PhoneIcon />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`voice-call-overlay phase-${phase}${isIncoming ? ' ringing' : ''}${
        remoteSpeaking ? ' peer-speaking' : ''
      }${isGroup ? ' is-group' : ''}${isVideo ? ' is-video' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={isGroup ? 'Group call' : isVideo ? 'Video call' : 'Voice call'}
    >
      <div className="voice-call-stage">
        <header className="voice-call-top">
          <span className="voice-call-brand">
            {isGroup
              ? `Relay Group ${isVideo ? 'Video' : 'Call'}`
              : isVideo
                ? 'Relay Video Call'
                : 'Relay Call'}
          </span>
          {canMinimize ? (
            <div className="voice-call-top-actions">
              <button
                type="button"
                className="voice-call-minimize"
                aria-label="People"
                onClick={() => setParticipantsOpen(true)}
              >
                <span>People</span>
              </button>
              {supportsPip ? (
                <button
                  type="button"
                  className="voice-call-minimize"
                  aria-label="Picture in picture"
                  onClick={() => void enterPip()}
                >
                  <span>PiP</span>
                </button>
              ) : null}
              <button
                type="button"
                className="voice-call-minimize"
                aria-label="Minimize call"
                onClick={() => setMinimized(true)}
              >
                <MinimizeIcon />
                <span>Minimize</span>
              </button>
            </div>
          ) : (
            <span />
          )}
        </header>

        {onHold ? (
          <div className="voice-call-hold-banner" role="status">
            Call on hold
          </div>
        ) : null}
        {forceMuted && !isHost ? (
          <div className="voice-call-hold-banner muted-all" role="status">
            Host muted everyone
          </div>
        ) : null}
        {showingShare && !shareExpanded ? (
          <div className="voice-call-hold-banner share" role="status">
            {screenSharerId === me
              ? 'You are sharing your screen'
              : 'Screen sharing'}
          </div>
        ) : null}

        {showNetworkBanner ? (
          <div
            className={`voice-call-network-banner quality-${networkQuality}`}
            role="status"
          >
            {networkHint}
          </div>
        ) : null}

        <div className="voice-call-hero">
          {showingShare && (inCall || isOutgoing) ? (
            <div
              className={`voice-call-share-layout${
                shareExpanded ? ' expanded' : ''
              }`}
            >
              <div className="voice-call-share-stage">
                <VideoTile
                  stream={screenShareStream}
                  muted
                  label={shareLabel}
                  placeholder="Shared screen"
                  objectFit="contain"
                  className="share-main"
                />
                <button
                  type="button"
                  className="voice-call-share-expand"
                  aria-label={
                    shareExpanded
                      ? 'Exit full screen share'
                      : 'Expand shared screen'
                  }
                  onClick={() => setShareExpanded((open) => !open)}
                >
                  {shareExpanded ? 'Exit full screen' : 'Expand'}
                </button>
              </div>
              {!shareExpanded ? (
                <div className="voice-call-share-filmstrip">
                  <VideoTile
                    stream={screenSharing ? null : localStream}
                    muted
                    mirror={!screenSharing}
                    label="You"
                    placeholder="You"
                    speaking={false}
                  />
                  {isGroup
                    ? participantTiles
                        .filter((tile) => tile.userId !== screenSharerId)
                        .map((tile) => (
                          <VideoTile
                            key={tile.userId}
                            stream={tile.stream}
                            label={tile.name}
                            placeholder={tile.initials}
                            speaking={tile.speaking}
                          />
                        ))
                    : call?.peerUserId && call.peerUserId !== screenSharerId
                      ? (
                          <VideoTile
                            stream={remoteStreams[call.peerUserId]}
                            label={peerName}
                            placeholder={peerInitials}
                            speaking={remoteSpeaking}
                          />
                        )
                      : call?.peerUserId && call.peerUserId === screenSharerId
                        ? (
                            <VideoTile
                              stream={null}
                              label={peerName}
                              placeholder={peerInitials}
                              speaking={remoteSpeaking}
                            />
                          )
                        : null}
                </div>
              ) : null}
            </div>
          ) : showMediaStage ? (
            <div
              className={`voice-call-video-grid count-${Math.min(
                4,
                1 + (isGroup ? participantTiles.filter((t) => t.stream).length : call?.peerUserId && remoteStreams[call.peerUserId] ? 1 : 0),
              )}`}
            >
              <VideoTile
                stream={localStream}
                muted
                mirror
                label="You"
                placeholder="You"
                speaking={false}
              />
              {isGroup
                ? participantTiles
                    .filter((tile) => tile.stream)
                    .map((tile) => (
                      <VideoTile
                        key={tile.userId}
                        stream={tile.stream}
                        label={tile.name}
                        placeholder={tile.initials}
                        speaking={tile.speaking}
                      />
                    ))
                : call?.peerUserId && remoteStreams[call.peerUserId]
                  ? (
                      <VideoTile
                        stream={remoteStreams[call.peerUserId]}
                        label={peerName}
                        placeholder={peerInitials}
                        speaking={remoteSpeaking}
                      />
                    )
                  : null}
            </div>
          ) : isGroup && participantTiles.length > 0 ? (
            <div className="voice-call-grid">
              {participantTiles.map((tile) => (
                <div
                  key={tile.userId}
                  className={`voice-call-tile${tile.speaking ? ' speaking' : ''}`}
                >
                  <div className="voice-call-tile-avatar">
                    {tile.avatar ? (
                      <img src={tile.avatar} alt="" />
                    ) : (
                      <span>{tile.initials}</span>
                    )}
                  </div>
                  <span className="voice-call-tile-name">{tile.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div
              className={`voice-call-avatar-wrap${
                isIncoming || isOutgoing ? ' pulse' : ''
              }${remoteSpeaking ? ' speaking' : ''}`}
            >
              <span className="voice-call-ring r1" aria-hidden="true" />
              <span className="voice-call-ring r2" aria-hidden="true" />
              <span className="voice-call-ring r3" aria-hidden="true" />
              <div className="voice-call-avatar">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" />
                ) : (
                  <span>{peerInitials}</span>
                )}
              </div>
            </div>
          )}

          <h2 className="voice-call-name">{peerName}</h2>
          <p className="voice-call-status">{statusText}</p>
          {error && phase !== 'ended' ? (
            <p className="voice-call-error">{error}</p>
          ) : null}
          {phase === 'ended' ? (
            <p className="voice-call-ended-note">{error || 'Call ended'}</p>
          ) : null}
          {isGroup && isOutgoing && joinedOthers.length === 0 ? (
            <p className="voice-call-hint">Waiting for members to join…</p>
          ) : null}
        </div>

        <div className="voice-call-actions">
          {isIncoming ? (
            <>
              <div className="voice-call-action">
                <button
                  type="button"
                  className="voice-call-round end"
                  aria-label="Decline call"
                  onClick={() => void rejectCall()}
                >
                  <PhoneIcon />
                </button>
                <span>Decline</span>
              </div>
              {isVideo ? (
                <>
                  <div className="voice-call-action">
                    <button
                      type="button"
                      className="voice-call-round accept voice-only"
                      aria-label="Answer as voice call"
                      onClick={() => void acceptCall(false)}
                    >
                      <PhoneIcon />
                    </button>
                    <span>Voice</span>
                  </div>
                  <div className="voice-call-action">
                    <button
                      type="button"
                      className="voice-call-round accept"
                      aria-label="Accept video call"
                      onClick={() => void acceptCall(true)}
                    >
                      <CamIcon />
                    </button>
                    <span>Video</span>
                  </div>
                </>
              ) : (
                <div className="voice-call-action">
                  <button
                    type="button"
                    className="voice-call-round accept"
                    aria-label="Accept call"
                    onClick={() => void acceptCall(false)}
                  >
                    <PhoneIcon />
                  </button>
                  <span>Accept</span>
                </div>
              )}
            </>
          ) : null}

          {isOutgoing || inCall ? (
            <>
              <div className="voice-call-action">
                <button
                  type="button"
                  className={`voice-call-round mute${muted || forceMuted ? ' active' : ''}`}
                  aria-pressed={muted}
                  aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                  onClick={toggleMute}
                  disabled={forceMuted && !isHost}
                >
                  <MicIcon off={muted || forceMuted} />
                </button>
                <span>{muted || forceMuted ? 'Unmute' : 'Mute'}</span>
              </div>
              <div className="voice-call-action">
                <button
                  type="button"
                  className={`voice-call-round cam${cameraOn && !screenSharing ? '' : ' active'}`}
                  aria-pressed={cameraOn}
                  aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
                  onClick={() => void toggleCamera()}
                  disabled={screenSharing}
                >
                  <CamIcon off={!cameraOn || screenSharing} />
                </button>
                <span>{cameraOn && !screenSharing ? 'Camera' : 'Cam off'}</span>
              </div>
              {cameraOn && !screenSharing ? (
                <div className="voice-call-action">
                  <button
                    type="button"
                    className="voice-call-round cam"
                    aria-label="Switch camera"
                    onClick={() => void switchCamera()}
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M16 7h-1l-1-1H9L8 7H4v12h16V7h-4zm-4 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7-9h2v2h-2V8zM7.5 3.5 6 5H3v2h4.5l1-1.5H16L17 7h4V5h-3.5l-1-1.5h-9z"
                      />
                    </svg>
                  </button>
                  <span>Flip</span>
                </div>
              ) : null}
              <div className="voice-call-action">
                <button
                  type="button"
                  className={`voice-call-round hold${onHold ? ' active' : ''}`}
                  aria-pressed={onHold}
                  aria-label={onHold ? 'Resume call' : 'Put call on hold'}
                  onClick={() => void toggleHold()}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                  </svg>
                </button>
                <span>{onHold ? 'Resume' : 'Hold'}</span>
              </div>
              <div className="voice-call-action">
                <button
                  type="button"
                  className={`voice-call-round share${screenSharing ? ' active' : ''}${
                    !canShare && !screenSharing ? ' unavailable' : ''
                  }`}
                  aria-pressed={screenSharing}
                  aria-label={
                    !canShare
                      ? 'Screen sharing not supported on this device'
                      : screenSharing
                        ? 'Stop sharing'
                        : 'Share screen'
                  }
                  title={
                    !canShare && !screenSharing
                      ? SCREEN_SHARE_UNSUPPORTED_HINT
                      : undefined
                  }
                  onClick={() => void toggleScreenShare()}
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"
                    />
                  </svg>
                </button>
                <span>
                  {!canShare && !screenSharing
                    ? 'Desktop only'
                    : screenSharing
                      ? 'Stop'
                      : 'Share'}
                </span>
              </div>
              {isHost && isGroup ? (
                <div className="voice-call-action">
                  <button
                    type="button"
                    className={`voice-call-round mute${forceMuted ? ' active' : ''}`}
                    aria-pressed={forceMuted}
                    aria-label={forceMuted ? 'Unmute everyone' : 'Mute everyone'}
                    onClick={() => void toggleMuteAll()}
                  >
                    <MicIcon off />
                  </button>
                  <span>{forceMuted ? 'Unmute all' : 'Mute all'}</span>
                </div>
              ) : null}
              <div className="voice-call-action speaker-action">
                <button
                  type="button"
                  className="voice-call-round speaker"
                  aria-label="Audio output"
                  onClick={() => {
                    void refreshAudioOutputs();
                    setClarityOpen((open) => !open);
                  }}
                >
                  <SpeakerIcon />
                </button>
                {clarityOpen ? (
                  <div className="voice-call-clarity-menu">
                    <label className="voice-call-speaker-select">
                      <span className="sr-only">Speaker</span>
                      <select
                        value={audioOutputId}
                        onChange={(event) => void setAudioOutput(event.target.value)}
                        aria-label="Choose speaker"
                      >
                        <option value="default">Default</option>
                        {audioOutputs.map((device) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {device.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="voice-call-speaker-select">
                      <span className="sr-only">Voice clarity</span>
                      <select
                        value={voiceClarity}
                        onChange={(event) =>
                          void setVoiceClarity(event.target.value as VoiceClarityMode)
                        }
                        aria-label="Voice clarity mode"
                      >
                        {(Object.keys(VOICE_CLARITY_LABELS) as VoiceClarityMode[]).map(
                          (mode) => (
                            <option key={mode} value={mode}>
                              {VOICE_CLARITY_LABELS[mode]}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                ) : (
                  <span>Audio</span>
                )}
              </div>
              <div className="voice-call-action">
                <button
                  type="button"
                  className="voice-call-round end"
                  aria-label={isOutgoing ? 'Cancel call' : 'Leave call'}
                  onClick={() => void hangup()}
                >
                  <PhoneIcon />
                </button>
                <span>{isOutgoing ? 'Cancel' : isGroup ? 'Leave' : 'End'}</span>
              </div>
            </>
          ) : null}
        </div>

        {call ? (
          <CallParticipantsPanel
            call={call}
            roster={roster}
            me={me}
            open={participantsOpen}
            onClose={() => setParticipantsOpen(false)}
            onInvite={inviteParticipants}
          />
        ) : null}
      </div>
    </div>
  );
}
