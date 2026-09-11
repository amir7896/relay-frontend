/**
 * Lightweight call tones via Web Audio (no media assets).
 * - incoming: repeating ringtone
 * - outgoing: ringback cadence
 */

type ToneKind = 'incoming' | 'outgoing';

type ActiveTone = {
  kind: ToneKind;
  stop: () => void;
};

let sharedContext: AudioContext | null = null;
let unlocked = false;
let active: ActiveTone | null = null;
let toneEpoch = 0;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) {
    return null;
  }
  if (!sharedContext) {
    sharedContext = new Ctx();
  }
  return sharedContext;
}

/** Call once after a user gesture so ringtones can autoplay later. */
export async function unlockCallAudio(): Promise<void> {
  const ctx = getContext();
  if (!ctx) {
    return;
  }
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }
  unlocked = ctx.state === 'running';
}

export function stopCallRingtone(): void {
  toneEpoch += 1;
  active?.stop();
  active = null;
}

function playBeep(
  ctx: AudioContext,
  freqs: number[],
  startAt: number,
  duration: number,
  gainValue: number,
): void {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
  gain.gain.setValueAtTime(gainValue, startAt + Math.max(0.03, duration - 0.05));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  gain.connect(ctx.destination);

  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startAt);
    osc.connect(gain);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }
}

function beginToneLoop(kind: ToneKind, epoch: number): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== 'running' || epoch !== toneEpoch) {
    return;
  }

  let cancelled = false;
  let timer: number | null = null;

  const scheduleIncoming = () => {
    if (cancelled || epoch !== toneEpoch) {
      return;
    }
    const now = ctx.currentTime;
    playBeep(ctx, [440, 480], now, 0.4, 0.08);
    playBeep(ctx, [440, 480], now + 0.5, 0.4, 0.08);
    timer = window.setTimeout(scheduleIncoming, 2200);
  };

  const scheduleOutgoing = () => {
    if (cancelled || epoch !== toneEpoch) {
      return;
    }
    const now = ctx.currentTime;
    playBeep(ctx, [425], now, 0.9, 0.05);
    timer = window.setTimeout(scheduleOutgoing, 2800);
  };

  if (kind === 'incoming') {
    scheduleIncoming();
  } else {
    scheduleOutgoing();
  }

  active = {
    kind,
    stop: () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    },
  };
}

/**
 * Starts a looping ringtone. Replaces any existing tone.
 * Safe no-op if AudioContext is unavailable or still locked by the browser.
 */
export function startCallRingtone(kind: ToneKind): void {
  stopCallRingtone();
  const epoch = toneEpoch;
  const ctx = getContext();
  if (!ctx) {
    return;
  }

  const kickOff = () => {
    if (epoch !== toneEpoch) {
      return;
    }
    unlocked = ctx.state === 'running';
    if (!unlocked) {
      return;
    }
    beginToneLoop(kind, epoch);
  };

  if (ctx.state === 'running') {
    kickOff();
    return;
  }

  void ctx
    .resume()
    .then(kickOff)
    .catch(() => undefined);
}

/** Short confirmation beep when the call connects. */
export function playCallConnectedChime(): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== 'running') {
    return;
  }
  const now = ctx.currentTime;
  playBeep(ctx, [660], now, 0.12, 0.05);
  playBeep(ctx, [880], now + 0.14, 0.16, 0.05);
}

export function playCallEndedChime(): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== 'running') {
    return;
  }
  const now = ctx.currentTime;
  playBeep(ctx, [480], now, 0.14, 0.04);
  playBeep(ctx, [360], now + 0.16, 0.22, 0.04);
}
