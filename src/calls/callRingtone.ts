/**
 * Distinctive call tones via Web Audio (no media assets).
 * Incoming: branded melodic motif with warm pad + pulse (not a classic dual-tone ring).
 * Outgoing: soft ringback arpeggio.
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

function envelope(
  gain: GainNode,
  startAt: number,
  duration: number,
  peak: number,
  attack = 0.02,
  release = 0.08,
): void {
  const safePeak = Math.max(0.0001, peak);
  const attackEnd = startAt + Math.min(attack, duration * 0.35);
  const releaseStart = startAt + Math.max(attackEnd - startAt, duration - release);
  gain.gain.cancelScheduledValues(startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(safePeak, attackEnd);
  gain.gain.setValueAtTime(safePeak, releaseStart);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
}

function playTone(
  ctx: AudioContext,
  opts: {
    freq: number;
    startAt: number;
    duration: number;
    gainValue: number;
    type?: OscillatorType;
    detuneCents?: number;
    filterFreq?: number;
    vibratoHz?: number;
    vibratoDepth?: number;
  },
): void {
  const {
    freq,
    startAt,
    duration,
    gainValue,
    type = 'sine',
    detuneCents = 0,
    filterFreq,
    vibratoHz,
    vibratoDepth,
  } = opts;

  const gain = ctx.createGain();
  envelope(gain, startAt, duration, gainValue, 0.018, Math.min(0.12, duration * 0.4));

  let output: AudioNode = gain;
  if (filterFreq != null) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, startAt);
    filter.Q.setValueAtTime(0.7, startAt);
    gain.connect(filter);
    output = filter;
  }
  output.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  if (detuneCents) {
    osc.detune.setValueAtTime(detuneCents, startAt);
  }

  if (vibratoHz && vibratoDepth) {
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(vibratoHz, startAt);
    lfoGain.gain.setValueAtTime(vibratoDepth, startAt);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start(startAt);
    lfo.stop(startAt + duration + 0.02);
  }

  osc.connect(gain);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Soft two-oscillator "bell" for melody notes. */
function playBell(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  gainValue: number,
): void {
  playTone(ctx, {
    freq,
    startAt,
    duration,
    gainValue,
    type: 'triangle',
    filterFreq: freq * 4.5,
    vibratoHz: 4.5,
    vibratoDepth: 3.5,
  });
  playTone(ctx, {
    freq: freq * 2,
    startAt,
    duration: duration * 0.55,
    gainValue: gainValue * 0.22,
    type: 'sine',
    filterFreq: freq * 6,
  });
}

function playPadChord(
  ctx: AudioContext,
  freqs: number[],
  startAt: number,
  duration: number,
  gainValue: number,
): void {
  for (const freq of freqs) {
    playTone(ctx, {
      freq,
      startAt,
      duration,
      gainValue: gainValue / freqs.length,
      type: 'sawtooth',
      detuneCents: -6,
      filterFreq: 980,
    });
    playTone(ctx, {
      freq,
      startAt,
      duration,
      gainValue: (gainValue * 0.7) / freqs.length,
      type: 'triangle',
      detuneCents: 8,
      filterFreq: 1400,
    });
  }
}

/**
 * Incoming motif — ascending Relay-like phrase over a warm pad (≈3.2s loop).
 * Notes (Hz): A4 → C#5 → E5 → F#5 → E5 → C#5
 */
function scheduleIncomingBurst(ctx: AudioContext, startAt: number): void {
  playPadChord(ctx, [220, 277.18, 329.63], startAt, 1.15, 0.045);

  const melody: Array<{ freq: number; at: number; dur: number; gain: number }> = [
    { freq: 440.0, at: 0.0, dur: 0.28, gain: 0.09 },
    { freq: 554.37, at: 0.28, dur: 0.28, gain: 0.095 },
    { freq: 659.25, at: 0.56, dur: 0.32, gain: 0.1 },
    { freq: 739.99, at: 0.9, dur: 0.36, gain: 0.1 },
    { freq: 659.25, at: 1.32, dur: 0.28, gain: 0.085 },
    { freq: 554.37, at: 1.62, dur: 0.4, gain: 0.075 },
  ];

  for (const note of melody) {
    playBell(ctx, note.freq, startAt + note.at, note.dur, note.gain);
  }

  // Soft bass pulse under the second half
  playTone(ctx, {
    freq: 110,
    startAt: startAt + 0.85,
    duration: 0.55,
    gainValue: 0.04,
    type: 'sine',
    filterFreq: 320,
  });
  playTone(ctx, {
    freq: 138.59,
    startAt: startAt + 1.55,
    duration: 0.45,
    gainValue: 0.035,
    type: 'sine',
    filterFreq: 360,
  });
}

/** Outgoing ringback — gentle descending chime, not a flat carrier beep. */
function scheduleOutgoingBurst(ctx: AudioContext, startAt: number): void {
  playTone(ctx, {
    freq: 523.25,
    startAt,
    duration: 0.42,
    gainValue: 0.055,
    type: 'sine',
    filterFreq: 1800,
  });
  playTone(ctx, {
    freq: 392.0,
    startAt: startAt + 0.38,
    duration: 0.55,
    gainValue: 0.05,
    type: 'triangle',
    filterFreq: 1400,
  });
  playTone(ctx, {
    freq: 261.63,
    startAt: startAt + 0.85,
    duration: 0.5,
    gainValue: 0.04,
    type: 'sine',
    filterFreq: 900,
  });
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
    scheduleIncomingBurst(ctx, ctx.currentTime);
    timer = window.setTimeout(scheduleIncoming, 3200);
  };

  const scheduleOutgoing = () => {
    if (cancelled || epoch !== toneEpoch) {
      return;
    }
    scheduleOutgoingBurst(ctx, ctx.currentTime);
    timer = window.setTimeout(scheduleOutgoing, 3000);
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

/** Short confirmation chime when the call connects. */
export function playCallConnectedChime(): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== 'running') {
    return;
  }
  const now = ctx.currentTime;
  playBell(ctx, 523.25, now, 0.16, 0.07);
  playBell(ctx, 659.25, now + 0.12, 0.18, 0.075);
  playBell(ctx, 783.99, now + 0.26, 0.28, 0.08);
}

export function playCallEndedChime(): void {
  const ctx = getContext();
  if (!ctx || ctx.state !== 'running') {
    return;
  }
  const now = ctx.currentTime;
  playBell(ctx, 587.33, now, 0.18, 0.055);
  playBell(ctx, 440.0, now + 0.16, 0.22, 0.05);
  playBell(ctx, 329.63, now + 0.36, 0.34, 0.045);
}
