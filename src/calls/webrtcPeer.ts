/**
 * Thin WebRTC peer helper for 1:1 links inside a mesh call (audio + video).
 * Uses replaceTrack / addTrack + renegotiation so mid-call camera and
 * screen-share work across Chrome, Firefox, and mobile browsers.
 */

export type VoicePeerHandlers = {
  onRemoteStream: (stream: MediaStream) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceConnectionState?: (state: RTCIceConnectionState) => void;
};

function isVideoTransceiver(transceiver: RTCRtpTransceiver): boolean {
  return (
    transceiver.sender.track?.kind === 'video' ||
    transceiver.receiver.track?.kind === 'video'
  );
}

export class VoicePeer {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private ownsLocal = false;
  private remoteStream: MediaStream | null = null;
  /** Serialize offer/answer so mobile glare races can't set answer in `stable`. */
  private negotiationChain: Promise<void> = Promise.resolve();
  private makingOffer = false;

  constructor(
    private readonly iceServers: RTCIceServer[],
    private readonly handlers: VoicePeerHandlers,
  ) {}

  get muted(): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    return track ? !track.enabled : false;
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setCameraEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  async startLocalMedia(
    existing?: MediaStream,
    options?: { video?: boolean; facingMode?: 'user' | 'environment' },
  ): Promise<MediaStream> {
    if (existing) {
      this.localStream = existing;
      this.ownsLocal = false;
      return existing;
    }
    const wantVideo = Boolean(options?.video);
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: wantVideo
        ? {
            facingMode: options?.facingMode ?? 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : false,
    });
    this.ownsLocal = true;
    return this.localStream;
  }

  async startLocalAudio(existing?: MediaStream): Promise<MediaStream> {
    return this.startLocalMedia(existing, { video: false });
  }

  async createPeerConnection(): Promise<RTCPeerConnection> {
    if (this.pc) {
      return this.pc;
    }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.handlers.onIceCandidate(event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      if (!this.remoteStream) {
        this.remoteStream = event.streams[0] ?? new MediaStream();
      }
      if (
        !this.remoteStream.getTracks().some((track) => track.id === event.track.id)
      ) {
        this.remoteStream.addTrack(event.track);
      }
      // Always notify so UI can pick up newly added video tracks
      this.handlers.onRemoteStream(this.remoteStream);
    };

    pc.onconnectionstatechange = () => {
      this.handlers.onConnectionState?.(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      this.handlers.onIceConnectionState?.(pc.iceConnectionState);
    };

    return pc;
  }

  /**
   * Sync local mic/cam/screen onto the PC.
   * Returns true when an SDP offer/answer round is required.
   */
  async syncLocalTracks(stream: MediaStream): Promise<boolean> {
    this.localStream = stream;
    const pc = await this.createPeerConnection();
    let needsNegotiation = false;

    for (const track of stream.getTracks()) {
      const sender = pc
        .getSenders()
        .find((item) => item.track?.kind === track.kind);
      if (sender) {
        if (sender.track?.id !== track.id) {
          await sender.replaceTrack(track);
        }
      } else {
        pc.addTrack(track, stream);
        needsNegotiation = true;
      }
    }

    for (const sender of pc.getSenders()) {
      if (
        sender.track &&
        !stream.getTracks().some((track) => track.kind === sender.track?.kind)
      ) {
        await sender.replaceTrack(null);
        needsNegotiation = true;
      }
    }

    const sendingVideo = stream.getVideoTracks().length > 0;
    const videoTx = pc.getTransceivers().find(isVideoTransceiver);
    if (!videoTx) {
      pc.addTransceiver('video', {
        direction: sendingVideo ? 'sendrecv' : 'recvonly',
      });
      needsNegotiation = true;
    } else if (sendingVideo && videoTx.direction === 'recvonly') {
      videoTx.direction = 'sendrecv';
      needsNegotiation = true;
    } else if (
      sendingVideo &&
      (videoTx.direction === 'inactive' || videoTx.direction === 'sendonly')
    ) {
      if (videoTx.direction === 'inactive') {
        videoTx.direction = 'sendrecv';
        needsNegotiation = true;
      }
    }

    return needsNegotiation;
  }

  private enqueueNegotiation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.negotiationChain.then(task, task);
    this.negotiationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async createOffer(options?: {
    video?: boolean;
  }): Promise<RTCSessionDescriptionInit> {
    return this.enqueueNegotiation(async () => {
      const pc = await this.createPeerConnection();
      const wantVideo = Boolean(options?.video);
      const sendingVideo = Boolean(this.localStream?.getVideoTracks().length);

      if (wantVideo || sendingVideo) {
        const videoTx = pc.getTransceivers().find(isVideoTransceiver);
        if (!videoTx) {
          pc.addTransceiver('video', {
            direction: sendingVideo ? 'sendrecv' : 'recvonly',
          });
        } else if (sendingVideo && videoTx.direction === 'recvonly') {
          videoTx.direction = 'sendrecv';
        } else if (!sendingVideo && videoTx.direction === 'inactive') {
          videoTx.direction = 'recvonly';
        }
      }

      // Already answering a remote offer — don't stomp with a local offer
      if (
        pc.signalingState === 'have-remote-offer' ||
        pc.signalingState === 'have-local-pranswer'
      ) {
        throw new Error('skip-offer-have-remote');
      }

      this.makingOffer = true;
      try {
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-local-offer') {
          throw new Error('skip-offer-state');
        }
        await pc.setLocalDescription(offer);
        return pc.localDescription!.toJSON();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/skip-offer|wrong state|stable/i.test(message)) {
          throw new Error('skip-offer-state');
        }
        throw err;
      } finally {
        this.makingOffer = false;
      }
    });
  }

  async acceptOffer(
    sdp: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit | null> {
    return this.enqueueNegotiation(async () => {
      const pc = await this.createPeerConnection();

      if (sdp.type && sdp.type !== 'offer') {
        return null;
      }

      // Perfect negotiation: if we have a local offer in flight, roll it back
      if (
        this.makingOffer ||
        pc.signalingState === 'have-local-offer'
      ) {
        try {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setLocalDescription({ type: 'rollback' });
          }
        } catch {
          // Ignore rollback failures; state may already have moved
        }
      }

      // Already answering — wait for our queued turn (serialized); if still
      // not ready for a new remote offer, skip instead of crashing mobile UI
      if (
        pc.signalingState === 'have-remote-offer' ||
        pc.signalingState === 'have-local-pranswer'
      ) {
        return null;
      }

      try {
        await pc.setRemoteDescription(sdp);
      } catch {
        // Duplicate / incompatible offer — common on flaky mobile networks
        return null;
      }

      if (this.localStream) {
        await this.syncLocalTracks(this.localStream);
      }

      // Cast: TS narrows signalingState across the early returns above and
      // doesn't know setRemoteDescription moves us to have-remote-offer.
      const afterRemote = pc.signalingState as RTCSignalingState;
      if (afterRemote !== 'have-remote-offer') {
        return null;
      }

      try {
        const answer = await pc.createAnswer();
        const afterAnswer = pc.signalingState as RTCSignalingState;
        if (afterAnswer !== 'have-remote-offer') {
          return null;
        }
        await pc.setLocalDescription(answer);
        return pc.localDescription!.toJSON();
      } catch {
        return null;
      }
    });
  }

  async acceptAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    return this.enqueueNegotiation(async () => {
      const pc = await this.createPeerConnection();
      if (pc.signalingState !== 'have-local-offer') {
        return;
      }
      if (sdp.type && sdp.type !== 'answer' && sdp.type !== 'pranswer') {
        return;
      }
      try {
        await pc.setRemoteDescription(sdp);
      } catch {
        // Duplicate / late answer — common on mobile glare races
      }
    });
  }

  async addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!this.pc || !candidate) {
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // Candidate may arrive before remote description
    }
  }

  /**
   * ICE restart for NAT blips / failed paths. Returns a new offer the caller
   * must signal to the remote peer (same as a normal offer).
   */
  async restartIce(): Promise<RTCSessionDescriptionInit> {
    return this.enqueueNegotiation(async () => {
      const pc = await this.createPeerConnection();
      if (
        pc.signalingState === 'have-remote-offer' ||
        pc.signalingState === 'have-local-pranswer'
      ) {
        throw new Error('skip-offer-have-remote');
      }
      this.makingOffer = true;
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        return pc.localDescription!.toJSON();
      } finally {
        this.makingOffer = false;
      }
    });
  }

  async getStats(): Promise<RTCStatsReport | null> {
    if (!this.pc) {
      return null;
    }
    try {
      return await this.pc.getStats();
    } catch {
      return null;
    }
  }

  get connectionState(): RTCPeerConnectionState | null {
    return this.pc?.connectionState ?? null;
  }

  get iceConnectionState(): RTCIceConnectionState | null {
    return this.pc?.iceConnectionState ?? null;
  }

  close(options?: { stopLocal?: boolean }): void {
    const pc = this.pc;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    }
    this.pc = null;
    this.remoteStream = null;
    const shouldStop =
      options?.stopLocal === true ||
      (options?.stopLocal !== false && this.ownsLocal);
    if (shouldStop) {
      this.localStream?.getTracks().forEach((track) => track.stop());
    }
    this.localStream = null;
    this.ownsLocal = false;
  }
}
