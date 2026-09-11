/**
 * Document Picture-in-Picture for a floating call bubble while browsing chats.
 * Falls back gracefully when the API is unavailable.
 */

export type CallPipHandle = {
  window: Window;
  close: () => void;
};

export function supportsDocumentPip(): boolean {
  return (
    typeof window !== 'undefined' &&
    'documentPictureInPicture' in window &&
    typeof (
      window as Window & {
        documentPictureInPicture?: { requestWindow: (opts?: object) => Promise<Window> };
      }
    ).documentPictureInPicture?.requestWindow === 'function'
  );
}

export async function openCallPip(options?: {
  width?: number;
  height?: number;
}): Promise<CallPipHandle | null> {
  if (!supportsDocumentPip()) {
    return null;
  }
  try {
    const api = (
      window as unknown as {
        documentPictureInPicture: {
          requestWindow: (opts?: {
            width?: number;
            height?: number;
          }) => Promise<Window>;
        };
      }
    ).documentPictureInPicture;

    const pipWindow = await api.requestWindow({
      width: options?.width ?? 320,
      height: options?.height ?? 180,
    });
    return {
      window: pipWindow,
      close: () => {
        try {
          pipWindow.close();
        } catch {
          // already closed
        }
      },
    };
  } catch {
    return null;
  }
}

/** Mirror styles into the PiP window so the bubble looks consistent. */
export function copyStylesToPip(pipWindow: Window): void {
  const styleSheets = Array.from(document.styleSheets);
  for (const sheet of styleSheets) {
    try {
      const rules = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n');
      const style = pipWindow.document.createElement('style');
      style.textContent = rules;
      pipWindow.document.head.appendChild(style);
    } catch {
      // Cross-origin stylesheets — skip
      if (sheet.href) {
        const link = pipWindow.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        pipWindow.document.head.appendChild(link);
      }
    }
  }
}
