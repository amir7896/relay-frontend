/**
 * Mic constraint presets beyond default browser AEC/NS.
 * Applied via getUserMedia / applyConstraints (no AudioWorklet dependency).
 */

export type VoiceClarityMode = 'standard' | 'clarity' | 'studio';

export const VOICE_CLARITY_LABELS: Record<VoiceClarityMode, string> = {
  standard: 'Standard',
  clarity: 'Voice clarity',
  studio: 'Studio',
};

export function audioConstraintsForMode(
  mode: VoiceClarityMode,
): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (mode === 'studio') {
    return {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: false,
      channelCount: 1,
      sampleRate: { ideal: 48000 },
    };
  }

  if (mode === 'clarity') {
    return {
      ...base,
      ...( {
        googNoiseSuppression2: true,
        googHighpassFilter: true,
        googEchoCancellation2: true,
      } as MediaTrackConstraints),
    };
  }

  return base;
}

export async function applyVoiceClarity(
  stream: MediaStream | null,
  mode: VoiceClarityMode,
): Promise<void> {
  const track = stream?.getAudioTracks()[0];
  if (!track || typeof track.applyConstraints !== 'function') {
    return;
  }
  try {
    await track.applyConstraints(audioConstraintsForMode(mode));
  } catch {
    if (mode !== 'standard') {
      try {
        await track.applyConstraints(audioConstraintsForMode('standard'));
      } catch {
        // Browser may not allow live constraint changes
      }
    }
  }
}
