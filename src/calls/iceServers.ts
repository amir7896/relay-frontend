import { api } from '../api/client';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
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
      cachedIceServers = servers;
      return servers;
    }
  } catch {
    // Fall through to public STUN defaults
  }
  cachedIceServers = DEFAULT_ICE_SERVERS;
  return DEFAULT_ICE_SERVERS;
}

export function clearIceServersCache(): void {
  cachedIceServers = null;
}
