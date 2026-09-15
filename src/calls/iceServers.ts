import { api } from '../api/client';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

/** Free Open Relay TURN — fine for local/dev; replace with your own TURN in production. */
const DEMO_TURN_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

let cachedIceServers: RTCIceServer[] | null = null;

/** Loads ICE servers from the authenticated API (includes TURN when configured). */
export async function loadIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceServers) {
    return cachedIceServers;
  }
  try {
    const response = await api<{ iceServers: RTCIceServer[] }>('/chat/webrtc-config');
    const servers = response.data?.iceServers;
    if (Array.isArray(servers) && servers.length > 0) {
      const hasTurn = servers.some((server) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some((url) => String(url).startsWith('turn'));
      });
      cachedIceServers = hasTurn ? servers : [...servers, ...DEMO_TURN_SERVERS];
      return cachedIceServers;
    }
  } catch {
    // Fall through to public STUN + demo TURN
  }
  cachedIceServers = [...DEFAULT_ICE_SERVERS, ...DEMO_TURN_SERVERS];
  return cachedIceServers;
}

export function clearIceServersCache(): void {
  cachedIceServers = null;
}
