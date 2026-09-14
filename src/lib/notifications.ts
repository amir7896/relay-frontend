import { api } from '../api/client';

const DISMISS_KEY = 'relay.notify.dismissed';

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
