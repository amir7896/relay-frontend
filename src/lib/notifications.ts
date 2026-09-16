import { api } from '../api/client';

const DISMISS_KEY = 'relay.notify.dismissed';
const PREFS_KEY = 'relay.notify.prefs';

export type NotificationMode = 'all' | 'mentions' | 'none';
export type ChannelNotifyMode = 'default' | 'all' | 'mentions' | 'none';

export type NotificationPrefs = {
  mode: NotificationMode;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  timezone: string;
  respectStatus: boolean;
  keywords: string[];
  channels: Record<string, Exclude<ChannelNotifyMode, 'default'>>;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  mode: 'all',
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  respectStatus: true,
  keywords: [],
  channels: {},
};

let cachedPrefs: NotificationPrefs | null = null;

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

export function wasNotificationPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissNotificationPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Ignore storage failures (private mode, etc.)
  }
}

export function clearNotificationPromptDismiss(): void {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    // Ignore storage failures
  }
}

/** Show the one-time inbox banner only if the browser still asks and user hasn't said Not now. */
export function shouldShowNotificationBanner(): boolean {
  return (
    getNotificationPermission() === 'default' && !wasNotificationPromptDismissed()
  );
}

export async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      clearNotificationPromptDismiss();
    }
    return permission;
  } catch {
    return Notification.permission;
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  // Dev: never register — old SW caches would hide Vite HMR updates.
  if (import.meta.env.DEV) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch {
      // Ignore cleanup failures
    }
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    void registration.update();
    return registration;
  } catch {
    return null;
  }
}

function applicationServerKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return buffer;
}

export async function subscribeWebPush(): Promise<
  NotificationPermission | 'unsupported' | 'disabled'
> {
  const permission = await requestPermission();
  if (permission !== 'granted') {
    return permission;
  }
  const registration = await registerServiceWorker();
  if (!registration || !('PushManager' in window)) {
    return 'unsupported';
  }
  const response = await api<{ publicKey: string; enabled: boolean }>(
    '/chat/push/vapid-public-key',
  );
  if (!response.data.enabled || !response.data.publicKey) {
    return 'disabled';
  }
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(response.data.publicKey),
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('Browser returned an invalid push subscription');
  }
  await api('/chat/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return 'granted';
}

function normalizePrefs(input: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  const keywords = Array.isArray(input?.keywords)
    ? input!.keywords
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];
  const channels: NotificationPrefs['channels'] = {};
  if (input?.channels && typeof input.channels === 'object') {
    for (const [id, mode] of Object.entries(input.channels)) {
      if (mode === 'all' || mode === 'mentions' || mode === 'none') {
        channels[id] = mode;
      }
    }
  }
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...input,
    keywords,
    channels,
  };
}

function readCachedPrefs(): NotificationPrefs {
  if (cachedPrefs) return cachedPrefs;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      cachedPrefs = normalizePrefs(JSON.parse(raw) as NotificationPrefs);
      return cachedPrefs;
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_NOTIFICATION_PREFS, keywords: [], channels: {} };
}

function writeCachedPrefs(prefs: NotificationPrefs): void {
  cachedPrefs = prefs;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function getCachedNotificationPrefs(): NotificationPrefs {
  return readCachedPrefs();
}

export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const response = await api<NotificationPrefs>('/chat/notification-prefs');
    const prefs = normalizePrefs(response.data);
    writeCachedPrefs(prefs);
    return prefs;
  } catch {
    return readCachedPrefs();
  }
}

export async function saveNotificationPrefs(
  patch: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  // Global PATCH rejects `channels` (forbidNonWhitelisted). Per-channel
  // overrides use PUT /chat/conversations/:id/notification-prefs.
  const { channels: _channels, ...globalPatch } = patch;
  const response = await api<NotificationPrefs>('/chat/notification-prefs', {
    method: 'PATCH',
    body: JSON.stringify(globalPatch),
  });
  const prefs = normalizePrefs(response.data);
  writeCachedPrefs(prefs);
  return prefs;
}

export async function loadChannelNotificationMode(
  conversationId: string,
): Promise<ChannelNotifyMode> {
  try {
    const response = await api<{ conversationId: string; mode: ChannelNotifyMode }>(
      `/chat/conversations/${conversationId}/notification-prefs`,
    );
    const mode = response.data.mode;
    if (mode === 'all' || mode === 'mentions' || mode === 'none' || mode === 'default') {
      return mode;
    }
    return 'default';
  } catch {
    return readCachedPrefs().channels[conversationId] ?? 'default';
  }
}

export async function saveChannelNotificationMode(
  conversationId: string,
  mode: ChannelNotifyMode,
): Promise<ChannelNotifyMode> {
  const response = await api<{ conversationId: string; mode: ChannelNotifyMode }>(
    `/chat/conversations/${conversationId}/notification-prefs`,
    {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    },
  );
  const prefs = readCachedPrefs();
  const channels = { ...prefs.channels };
  if (mode === 'default') {
    delete channels[conversationId];
  } else {
    channels[conversationId] = mode;
  }
  writeCachedPrefs({ ...prefs, channels });
  return response.data.mode;
}

function parseHm(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function localMinutes(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    const h = hour === 24 ? 0 : hour;
    return h * 60 + minute;
  } catch {
    return null;
  }
}

export function isInQuietHours(
  prefs: NotificationPrefs = readCachedPrefs(),
  now = new Date(),
): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const start = parseHm(prefs.quietStart);
  const end = parseHm(prefs.quietEnd);
  if (start === null || end === null) return false;
  const minutes = localMinutes(now, prefs.timezone);
  if (minutes === null) return false;
  if (start <= end) {
    return minutes >= start && minutes < end;
  }
  return minutes >= start || minutes < end;
}

function matchesKeyword(body: string | null | undefined, keywords: string[]): boolean {
  const text = String(body || '').toLowerCase();
  if (!text || !keywords.length) return false;
  return keywords.some((keyword) => {
    const needle = keyword.toLowerCase();
    if (!needle) return false;
    if (needle.includes(' ')) return text.includes(needle);
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(text);
  });
}

function resolveEffectiveMode(
  prefs: NotificationPrefs,
  conversationId?: string,
): NotificationMode {
  if (!conversationId) return prefs.mode;
  const override = prefs.channels[conversationId];
  if (override === 'all' || override === 'mentions' || override === 'none') {
    return override;
  }
  return prefs.mode;
}

/** Whether a foreground/desktop notification should fire for this message. */
export function getMessageNotifyDecision(input: {
  conversationId?: string;
  mentionsMe: boolean;
  muted?: boolean;
  body?: string | null;
  myStatus?: 'online' | 'away' | 'busy' | 'dnd' | 'offline';
}): { notify: boolean; matchedKeyword: boolean } {
  const prefs = readCachedPrefs();
  const matchedKeyword = matchesKeyword(input.body, prefs.keywords);
  const isHighlight = input.mentionsMe || matchedKeyword;
  const effective = resolveEffectiveMode(prefs, input.conversationId);

  if (input.muted && !isHighlight) {
    return { notify: false, matchedKeyword };
  }
  if (effective === 'none' && !isHighlight) {
    return { notify: false, matchedKeyword };
  }
  if (effective === 'mentions' && !isHighlight) {
    return { notify: false, matchedKeyword };
  }
  if (isInQuietHours(prefs) && !isHighlight) {
    return { notify: false, matchedKeyword };
  }
  if (prefs.respectStatus) {
    const status = input.myStatus;
    if (status === 'dnd' || status === 'busy') {
      return { notify: false, matchedKeyword };
    }
    if (status === 'away' && !isHighlight) {
      return { notify: false, matchedKeyword };
    }
  }
  return { notify: true, matchedKeyword };
}

export function shouldNotifyForMessage(input: {
  conversationId?: string;
  mentionsMe: boolean;
  muted?: boolean;
  body?: string | null;
  myStatus?: 'online' | 'away' | 'busy' | 'dnd' | 'offline';
}): boolean {
  return getMessageNotifyDecision(input).notify;
}

export function notify(options: {
  title: string;
  body: string;
  tag?: string;
}): void {
  if (!notificationsSupported()) {
    return;
  }
  if (Notification.permission !== 'granted') {
    return;
  }
  if (!document.hidden) {
    return;
  }
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      tag: options.tag,
      silent: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Ignore notification failures (unsupported context, etc.)
  }
}
