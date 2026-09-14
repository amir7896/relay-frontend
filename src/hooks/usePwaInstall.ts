import { useCallback, useEffect, useState } from 'react';
import {
  canPromptInstall,
  dismissInstallPrompt,
  initPwaInstallListeners,
  isStandaloneDisplay,
  promptInstall,
  shouldShowInstallBanner,
  subscribeInstallAvailability,
  wasInstallPromptDismissed,
} from '../lib/pwa';

let listenersInitialized = false;

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(canPromptInstall);
  const [standalone, setStandalone] = useState(isStandaloneDisplay);
  const [showBanner, setShowBanner] = useState(shouldShowInstallBanner);

  useEffect(() => {
    if (!listenersInitialized) {
      initPwaInstallListeners();
      listenersInitialized = true;
    }

    const sync = () => {
      setCanInstall(canPromptInstall());
      setStandalone(isStandaloneDisplay());
      setShowBanner(shouldShowInstallBanner());
    };

    sync();
    return subscribeInstallAvailability(sync);
  }, []);

  const install = useCallback(async () => {
    const outcome = await promptInstall();
    setCanInstall(canPromptInstall());
    setShowBanner(shouldShowInstallBanner());
    return outcome;
  }, []);

  const dismissBanner = useCallback(() => {
    dismissInstallPrompt();
    setShowBanner(false);
  }, []);

  return {
    canInstall,
    standalone,
    showBanner,
    dismissed: wasInstallPromptDismissed(),
    install,
    dismissBanner,
  };
}
