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
