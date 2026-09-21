import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type VoiceNotePlayerProps = {
  src: string;
  mime?: string;
  mine?: boolean;
  sendStatus?: 'uploading' | 'sending' | 'failed';
  uploadProgress?: number;
  onRetry?: () => void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function resolveMediaUrl(url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  if (url.startsWith('/')) {
    return url;
  }
  return `/${url}`;
}

const WAVE_BARS = 32;

function fallbackPeaks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    return 0.28 + ((index * 17) % 40) / 100;
  });
}

/** Decode audio into normalized peak levels for waveform scrubbing. */
async function extractWavePeaks(
  url: string,
  barCount = WAVE_BARS,
): Promise<number[]> {
  if (!url || typeof window === 'undefined') {
    return fallbackPeaks(barCount);
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) {
    return fallbackPeaks(barCount);
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return fallbackPeaks(barCount);
    const buffer = await response.arrayBuffer();
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(buffer.slice(0));
      const channel = decoded.getChannelData(0);
      if (!channel.length) return fallbackPeaks(barCount);
      const block = Math.max(1, Math.floor(channel.length / barCount));
      const peaks: number[] = [];
      for (let i = 0; i < barCount; i += 1) {
        const start = i * block;
        const end = Math.min(channel.length, start + block);
        let peak = 0;
        for (let j = start; j < end; j += 1) {
          const value = Math.abs(channel[j] ?? 0);
          if (value > peak) peak = value;
        }
        peaks.push(peak);
      }
      const max = Math.max(...peaks, 0.01);
      return peaks.map((peak) => Math.max(0.12, peak / max));
    } finally {
      void ctx.close().catch(() => undefined);
    }
  } catch {
    return fallbackPeaks(barCount);
  }
}

/** Prefer finite duration; fall back to seekable range (common for WebM). */
function readMediaDuration(audio: HTMLAudioElement): number {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return audio.duration;
  }
  if (audio.seekable.length > 0) {
    const end = audio.seekable.end(audio.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) {
      return end;
    }
  }
  return 0;
}

export function VoiceNotePlayer({
  src,
  mime,
  mine = false,
  sendStatus,
  uploadProgress = 0,
  onRetry,
}: VoiceNotePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrubRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const durationFixRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [peaks, setPeaks] = useState<number[]>(() => fallbackPeaks(WAVE_BARS));
  const mediaSrc = useMemo(() => resolveMediaUrl(src), [src]);
  const isPending = sendStatus === 'uploading' || sendStatus === 'sending';
  const isFailed = sendStatus === 'failed';
  const progressPct = Math.max(0, Math.min(100, uploadProgress));
  const canSeek = duration > 0 && !isPending && !isFailed && !error;

  useEffect(() => {
    let cancelled = false;
    setPeaks(fallbackPeaks(WAVE_BARS));
    if (!mediaSrc || isPending) {
      return () => {
        cancelled = true;
      };
    }
    void extractWavePeaks(mediaSrc, WAVE_BARS).then((next) => {
      if (!cancelled) setPeaks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaSrc, isPending]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setError('');
    setCurrent(0);
    setDuration(0);
    setPlaying(false);
    durationFixRef.current = false;
    draggingRef.current = false;

    const syncDuration = () => {
      const next = readMediaDuration(audio);
      if (next > 0) {
        setDuration(next);
      }
    };

    /** Chrome often reports WebM duration as Infinity until we seek near the end. */
    const fixInfiniteDuration = () => {
      if (durationFixRef.current) {
        return;
      }
      if (audio.duration !== Infinity && Number.isFinite(audio.duration)) {
        syncDuration();
        return;
      }
      durationFixRef.current = true;
      const previous = audio.currentTime;
      const onSeeked = () => {
        audio.removeEventListener('seeked', onSeeked);
        const fixed = readMediaDuration(audio);
        if (fixed > 0) {
          setDuration(fixed);
        }
        try {
          audio.currentTime = previous > 0 && previous < fixed ? previous : 0;
        } catch {
          audio.currentTime = 0;
        }
      };
      audio.addEventListener('seeked', onSeeked);
      try {
        audio.currentTime = 1e101;
      } catch {
        durationFixRef.current = false;
        audio.removeEventListener('seeked', onSeeked);
      }
    };

    const onTime = () => {
      if (!draggingRef.current) {
        setCurrent(audio.currentTime || 0);
      }
      syncDuration();
    };
    const onMeta = () => {
      syncDuration();
      if (!Number.isFinite(audio.duration) || audio.duration === Infinity) {
        fixInfiniteDuration();
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
      try {
        audio.currentTime = 0;
      } catch {
        // ignore
      }
    };
    const onError = () => {
      setPlaying(false);
      setError('Voice note could not be played');
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('canplay', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    if (audio.readyState >= 1) {
      onMeta();
    }

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('canplay', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [mediaSrc]);

  function seekToRatio(ratio: number, andPlay = false) {
    const audio = audioRef.current;
    if (!audio || !canSeek) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, ratio));
    const time = clamped * duration;
    try {
      audio.currentTime = time;
    } catch {
      return;
    }
    setCurrent(time);
    if (andPlay && audio.paused) {
      void audio.play().catch(() => {
        setError('Voice note could not be played');
      });
    }
  }

  function ratioFromClientX(clientX: number): number {
    const el = scrubRef.current;
    if (!el) {
      return 0;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) {
      return 0;
    }
    return (clientX - rect.left) / rect.width;
  }

  function onScrubPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canSeek) {
      return;
    }
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToRatio(ratioFromClientX(event.clientX));
  }

  function onScrubPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !canSeek) {
      return;
    }
    seekToRatio(ratioFromClientX(event.clientX));
  }

  function onScrubPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio || error || isPending) return;
    if (isFailed && onRetry) {
      onRetry();
      return;
    }
    try {
      if (audio.paused) {
        // Ensure duration is known before first play when possible
        if (!duration) {
          const next = readMediaDuration(audio);
          if (next > 0) {
            setDuration(next);
          }
        }
        await audio.play();
      } else {
        audio.pause();
      }
    } catch {
      setError('Voice note could not be played');
    }
  }

  function onRangeSeek(value: number) {
    if (!canSeek || !Number.isFinite(value)) {
      return;
    }
    seekToRatio(duration > 0 ? value / duration : 0);
  }

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const ringStyle = {
    background: `conic-gradient(var(--accent, #0d9488) ${progressPct * 3.6}deg, color-mix(in srgb, var(--muted) 35%, transparent) 0deg)`,
  };

  return (
    <div
      className={`voice-note${mine ? ' mine' : ' theirs'}${error ? ' is-error' : ''}${
        isPending ? ' is-sending' : ''
      }${isFailed ? ' is-failed' : ''}`}
    >
      <audio
        ref={audioRef}
        preload="auto"
        src={mediaSrc}
        {...(mime ? { 'data-mime': mime } : {})}
      />
      <button
        className={`voice-note-play${isPending ? ' sending' : ''}`}
        type="button"
        aria-label={
          isFailed
            ? 'Retry sending voice note'
            : isPending
              ? 'Sending voice note'
              : playing
                ? 'Pause voice note'
                : 'Play voice note'
        }
        onClick={() => void togglePlay()}
        disabled={Boolean(error) || isPending}
      >
        {isPending ? (
          <span className="voice-note-send-ring" style={ringStyle} aria-hidden="true">
            <span className="voice-note-send-ring-inner" />
          </span>
        ) : isFailed ? (
          <RetryIcon />
        ) : playing ? (
          <PauseIcon />
        ) : (
          <PlayIcon />
        )}
      </button>
      <div className="voice-note-body">
        <div
          ref={scrubRef}
          className={`voice-note-scrub${canSeek ? ' is-seekable' : ''}`}
          role="slider"
          tabIndex={canSeek ? 0 : -1}
          aria-label="Seek voice note"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 100) / 100}
          aria-valuenow={Math.round(current * 100) / 100}
          aria-valuetext={formatTime(current)}
          aria-disabled={!canSeek}
          onPointerDown={onScrubPointerDown}
          onPointerMove={onScrubPointerMove}
          onPointerUp={onScrubPointerUp}
          onPointerCancel={onScrubPointerUp}
          onKeyDown={(event) => {
            if (!canSeek) {
              return;
            }
            const step = Math.max(0.25, duration * 0.05);
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              seekToRatio((current + step) / duration);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              seekToRatio((current - step) / duration);
            } else if (event.key === 'Home') {
              event.preventDefault();
              seekToRatio(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              seekToRatio(1);
            }
          }}
        >
          <div className="voice-note-wave" aria-hidden="true">
            {peaks.map((peak, index) => (
              <span
                key={index}
                className={
                  isPending
                    ? progressPct >= ((index + 1) / peaks.length) * 100
                      ? 'is-played'
                      : undefined
                    : progress >= ((index + 1) / peaks.length) * 100
                      ? 'is-played'
                      : undefined
                }
                style={{ height: `${Math.round(18 + peak * 70)}%` }}
              />
            ))}
          </div>
          <div className="voice-note-track" aria-hidden="true">
            <div className="voice-note-track-fill" style={{ width: `${progress}%` }} />
            <span
              className="voice-note-thumb"
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>
        <input
          className="voice-note-seek visually-hidden"
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={Math.min(current, duration || 0)}
          aria-hidden="true"
          tabIndex={-1}
          disabled={!canSeek}
          onChange={(event) => onRangeSeek(Number(event.target.value))}
        />
        <div className="voice-note-meta">
          <span>
            {isPending
              ? sendStatus === 'uploading'
                ? `Sending ${Math.round(progressPct)}%`
                : 'Sending…'
              : isFailed
                ? 'Tap to retry'
                : formatTime(playing || current > 0 ? current : duration)}
          </span>
          {error ? <span className="voice-note-error">{error}</span> : null}
        </div>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M7 5h3.5v14H7V5Zm6.5 0H17v14h-3.5V5Z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5V2.5L8.5 6 12 9.5V7a5 5 0 1 1-4.9 6.1l-1.7.4A6.8 6.8 0 1 0 12 5Z"
      />
    </svg>
  );
}

export { resolveMediaUrl };
