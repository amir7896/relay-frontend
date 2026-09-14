const DISMISS_KEY = 'relay.pwa.install.dismissed';

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function wasInstallPromptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Ignore storage failures
  }
  notify();
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const media = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return media || iosStandalone;
}

export function canPromptInstall(): boolean {
  return Boolean(deferredPrompt) && !isStandaloneDisplay();
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function subscribeInstallAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt;
  if (!event) {
    return 'unavailable';
  }
  deferredPrompt = null;
  notify();
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') {
    dismissInstallPrompt();
  }
  return choice.outcome;
}

/** Call once from the app root to capture the browser install event. */
export function initPwaInstallListeners(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    dismissInstallPrompt();
  });
}

export function shouldShowInstallBanner(): boolean {
  return (
    canPromptInstall() && !wasInstallPromptDismissed() && !isStandaloneDisplay()
  );
}
