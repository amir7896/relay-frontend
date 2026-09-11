/**
 * Audio output routing helpers (speaker / headset / Bluetooth).
 * Uses enumerateDevices + setSinkId; auto-picks Bluetooth when plugged in.
 */

export type AudioOutputDevice = {
  deviceId: string;
  label: string;
  kind: 'bluetooth' | 'headset' | 'speaker' | 'other';
};

const BT_HINT = /bluetooth|airpods|buds|headset|hands[-\s]?free/i;
const HEADSET_HINT = /headset|earphone|headphone|usb audio|wired/i;
const SPEAKER_HINT = /speaker|default/i;

export function classifyAudioOutput(label: string): AudioOutputDevice['kind'] {
  if (BT_HINT.test(label)) {
    return 'bluetooth';
  }
  if (HEADSET_HINT.test(label)) {
    return 'headset';
  }
  if (SPEAKER_HINT.test(label)) {
    return 'speaker';
  }
  return 'other';
}

export async function listAudioOutputs(): Promise<AudioOutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => {
      const label = device.label || `Speaker ${index + 1}`;
      return {
        deviceId: device.deviceId || 'default',
        label,
        kind: classifyAudioOutput(label),
      };
    });
}

/** Prefer Bluetooth → headset → keep current if still present → default. */
export function pickPreferredOutput(
  devices: AudioOutputDevice[],
  currentId: string,
): string {
  if (devices.length === 0) {
    return currentId || 'default';
  }
  const bluetooth = devices.find((device) => device.kind === 'bluetooth');
  if (bluetooth) {
    return bluetooth.deviceId;
  }
  const headset = devices.find((device) => device.kind === 'headset');
  if (headset && currentId === 'default') {
    return headset.deviceId;
  }
  if (devices.some((device) => device.deviceId === currentId)) {
    return currentId;
  }
  return devices[0]?.deviceId ?? 'default';
}

export async function applySinkId(
  elements: Iterable<HTMLAudioElement | HTMLVideoElement>,
  deviceId: string,
): Promise<void> {
  const sinkId = deviceId === 'default' ? '' : deviceId;
  for (const element of elements) {
    const media = element as HTMLMediaElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (typeof media.setSinkId !== 'function') {
      continue;
    }
    try {
      await media.setSinkId(sinkId);
    } catch {
      // Device may have been unplugged mid-call
    }
  }
}

export function subscribeDeviceChanges(onChange: () => void): () => void {
  const media = navigator.mediaDevices;
  if (!media?.addEventListener) {
    return () => undefined;
  }
  const handler = () => onChange();
  media.addEventListener('devicechange', handler);
  return () => media.removeEventListener('devicechange', handler);
}
