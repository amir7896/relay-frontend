import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { useConfirm } from '../../../components/ConfirmProvider';
import { resolveMediaUrl } from '../../../components/VoiceNotePlayer';
import { displayName } from '../../../lib/format';
import { useDirectory } from '../../../people/useDirectory';
import type { Clip, MessageAttachment } from '../../../api/types';

const MAX_CLIP_SECONDS = 90;

type RecordMode = 'audio' | 'video';

function formatDuration(totalSeconds: number | null | undefined) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function pickMime(kinds: string[]) {
  return kinds.find((type) => MediaRecorder.isTypeSupported(type));
}

export function ClipsPanel({ conversationId }: { conversationId: string }) {
  const { session } = useAuth();
  const me = session?.user.id;
  const confirmDialog = useConfirm();
  const { byUserId, ensureProfiles } = useDirectory();
  const [clips, setClips] = useState<Clip[]>([]);
  const [mode, setMode] = useState<RecordMode>('audio');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const modeRef = useRef<RecordMode>('audio');
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    let active = true;
    setError('');
    api<Clip[]>(`/chat/conversations/${conversationId}/clips`)
      .then((response) => {
        if (!active) return;
        const next = response.data ?? [];
        setClips(next);
        const ids = [...new Set(next.map((clip) => clip.createdBy))];
        if (ids.length) void ensureProfiles(ids);
      })
      .catch(() => {
        if (active) setError('Clips are not available yet.');
      });
    return () => {
      active = false;
      cleanupRecorder();
    };
  }, [conversationId, ensureProfiles]);

  function cleanupRecorder() {
    if (maxTimerRef.current) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  }

  async function publishClip(
    blob: Blob,
    mediaType: RecordMode,
    durationSeconds: number,
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const extension = blob.type.includes('ogg') ? 'ogg' : 'webm';
      const fileName =
        mediaType === 'video'
          ? `clip-video-${Date.now()}.${extension}`
          : `clip-audio-${Date.now()}.${extension}`;
      const file = new File([blob], fileName, {
        type: blob.type || (mediaType === 'video' ? 'video/webm' : 'audio/webm'),
      });
      const form = new FormData();
      form.append('file', file);
      const upload = await api<MessageAttachment>('/chat/uploads', {
        method: 'POST',
        body: form,
      });
      const response = await api<Clip>(
        `/chat/conversations/${conversationId}/clips`,
        {
          method: 'POST',
          body: JSON.stringify({
            mediaUrl: upload.data.url,
            mediaType,
            durationSeconds,
            attachmentMime: upload.data.mime || file.type,
            attachmentName: upload.data.name || fileName,
            attachmentSize: upload.data.size ?? file.size,
          }),
        },
      );
      setClips((current) => [response.data, ...current]);
      void ensureProfiles([response.data.createdBy]);
      setNotice(
        `${mediaType === 'video' ? 'Video' : 'Audio'} clip shared to Messages.`,
      );
      window.dispatchEvent(
        new CustomEvent('relay:clip-shared', {
          detail: { conversationId, clipId: response.data.id },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the clip.');
    } finally {
      setBusy(false);
    }
  }

  async function startRecording(nextMode: RecordMode) {
    if (recording || busy) return;
    try {
      setError('');
      setNotice('');
      setMode(nextMode);
      modeRef.current = nextMode;
      const stream = await navigator.mediaDevices.getUserMedia(
        nextMode === 'video'
          ? { audio: true, video: { facingMode: 'user', width: 720, height: 720 } }
          : { audio: true },
      );
      streamRef.current = stream;
      if (nextMode === 'video' && previewRef.current) {
        previewRef.current.srcObject = stream;
        void previewRef.current.play().catch(() => undefined);
      }
      const mimeType =
        nextMode === 'video'
          ? pickMime(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'])
          : pickMime(['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']);
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (maxTimerRef.current) {
          window.clearTimeout(maxTimerRef.current);
          maxTimerRef.current = null;
        }
        if (tickRef.current) {
          window.clearInterval(tickRef.current);
          tickRef.current = null;
        }
        const seconds = Math.max(
          1,
          Math.min(
            MAX_CLIP_SECONDS,
            Math.round((Date.now() - startedAtRef.current) / 1000),
          ),
        );
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || (modeRef.current === 'video' ? 'video/webm' : 'audio/webm'),
        });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (previewRef.current) previewRef.current.srcObject = null;
        setRecording(false);
        setElapsed(0);
        if (blob.size) void publishClip(blob, modeRef.current, seconds);
      };
      startedAtRef.current = Date.now();
      setElapsed(0);
      tickRef.current = window.setInterval(() => {
        setElapsed(
          Math.min(
            MAX_CLIP_SECONDS,
            Math.round((Date.now() - startedAtRef.current) / 1000),
          ),
        );
      }, 250);
      maxTimerRef.current = window.setTimeout(() => {
        stopRecording();
      }, MAX_CLIP_SECONDS * 1000);
      recorder.start(250);
      setRecording(true);
    } catch {
      cleanupRecorder();
      setRecording(false);
      setError(
        nextMode === 'video'
          ? 'Camera and microphone permission are required for video clips.'
          : 'Microphone permission is required to record a clip.',
      );
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state !== 'inactive') {
      recorderRef.current?.stop();
    }
  }

  function cancelRecording() {
    chunksRef.current = [];
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    cleanupRecorder();
    setRecording(false);
    setElapsed(0);
    setNotice('Recording discarded.');
  }

  async function deleteClip(clip: Clip) {
    setNotice('');
    setError('');
    const confirmed = await confirmDialog({
      title: 'Delete clip?',
      message: 'This removes the clip from the channel for everyone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(`/chat/conversations/${conversationId}/clips/${clip.id}`, {
        method: 'DELETE',
      });
      setClips((current) => current.filter((row) => row.id !== clip.id));
      setNotice('Clip deleted.');
    } catch {
      setError('Could not delete the clip.');
    }
  }

  return (
    <section className="feature-panel clips-panel">
      <div className="feature-panel-head">
        <div>
          <h3>Clips</h3>
          <p className="muted">
            Record up to {MAX_CLIP_SECONDS}s — clips post into Messages for everyone.
          </p>
        </div>
      </div>

      <div className="clips-recorder">
        {recording && mode === 'video' ? (
          <video
            ref={previewRef}
            className="clips-preview"
            muted
            playsInline
            autoPlay
          />
        ) : null}

        <div className="clips-recorder-controls">
          {!recording ? (
            <>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => void startRecording('audio')}
              >
                <span className="record-dot" aria-hidden="true" />
                Record audio
              </button>
              <button
                className="ghost clips-secondary-btn"
                type="button"
                disabled={busy}
                onClick={() => void startRecording('video')}
              >
                Record video
              </button>
            </>
          ) : (
            <>
              <div className="clips-timer" role="status" aria-live="polite">
                <span className={`record-dot${recording ? ' live' : ''}`} aria-hidden="true" />
                Recording {mode} · {formatDuration(elapsed)} /{' '}
                {formatDuration(MAX_CLIP_SECONDS)}
              </div>
              <button
                className="btn clip-recording"
                type="button"
                onClick={stopRecording}
              >
                Stop &amp; share
              </button>
              <button className="ghost" type="button" onClick={cancelRecording}>
                Cancel
              </button>
            </>
          )}
        </div>
        {busy ? <p className="muted tab-notice">Uploading clip…</p> : null}
      </div>

      {error ? <p className="error tab-notice">{error}</p> : null}
      {notice ? (
        <p className="muted tab-notice" role="status">
          {notice}
        </p>
      ) : null}

      <ul className="clips-list">
        {clips.map((clip) => {
          const author = byUserId.get(clip.createdBy);
          const mine = clip.createdBy === me;
          const label = mine
            ? 'You'
            : displayName(author) || 'Teammate';
          return (
            <li key={clip.id} className={`clip-card clip-card-${clip.mediaType}`}>
              <div className="clip-card-meta">
                <span className="clip-badge">
                  {clip.mediaType === 'video' ? 'Video' : 'Audio'}
                </span>
                <strong>{label}</strong>
                <small className="muted">
                  {formatDuration(clip.durationSeconds)} ·{' '}
                  {clip.createdAt
                    ? new Date(clip.createdAt).toLocaleString()
                    : 'Just now'}
                </small>
              </div>
              <div className="clip-card-media">
                {clip.mediaType === 'video' ? (
                  <video
                    controls
                    preload="metadata"
                    src={resolveMediaUrl(clip.mediaUrl)}
                  />
                ) : (
                  <audio
                    controls
                    preload="metadata"
                    src={resolveMediaUrl(clip.mediaUrl)}
                  />
                )}
              </div>
              {mine ? (
                <button
                  className="ghost danger-link clip-delete"
                  type="button"
                  onClick={() => void deleteClip(clip)}
                >
                  Delete
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!error && clips.length === 0 ? (
        <p className="muted tab-empty">
          No clips yet. Record a short audio or video update for the channel.
        </p>
      ) : null}
    </section>
  );
}
