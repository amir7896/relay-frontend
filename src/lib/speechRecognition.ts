/** Browser Web Speech API helper for voice-note captions (no SaaS keys). */

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor());
}

export type VoiceCaptionSession = {
  stop: () => void;
};

/**
 * Start continuous speech recognition. Restarts on end while active
 * (Chrome often stops after a pause).
 */
export function startVoiceCaptionSession(options: {
  onUpdate: (finalText: string, interimText: string) => void;
  lang?: string;
}): VoiceCaptionSession | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;

  let active = true;
  let finalBuffer = '';
  let recognition: SpeechRecognitionLike | null = null;

  const attach = () => {
    if (!active) return;
    const next = new Ctor();
    recognition = next;
    next.continuous = true;
    next.interimResults = true;
    next.lang = options.lang || navigator.language || 'en-US';
    next.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = String(result?.[0]?.transcript ?? '').trim();
        if (!transcript) continue;
        if (result.isFinal) {
          finalBuffer = `${finalBuffer} ${transcript}`.trim();
        } else {
          interim = interim ? `${interim} ${transcript}` : transcript;
        }
      }
      options.onUpdate(finalBuffer, interim);
    };
    next.onerror = () => {
      // Ignore no-speech / aborted; keep UI usable with manual caption.
    };
    next.onend = () => {
      if (!active) return;
      // Restart after brief pause so long notes keep captioning.
      window.setTimeout(() => {
        if (!active) return;
        try {
          attach();
        } catch {
          // ignore
        }
      }, 120);
    };
    try {
      next.start();
    } catch {
      // Already started or permission denied
    }
  };

  attach();

  return {
    stop: () => {
      active = false;
      const current = recognition;
      recognition = null;
      if (!current) return;
      current.onend = null;
      current.onresult = null;
      current.onerror = null;
      try {
        current.stop();
      } catch {
        try {
          current.abort();
        } catch {
          // ignore
        }
      }
    },
  };
}
