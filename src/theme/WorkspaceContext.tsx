import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { WorkspaceCustomEmoji } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export type WorkspaceBranding = {
  appName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string | null;
  customEmojis: WorkspaceCustomEmoji[];
};

type WorkspaceContextValue = WorkspaceBranding & {
  refresh: () => Promise<void>;
};

const defaultBranding: WorkspaceBranding = {
  appName: 'Relay',
  tagline: 'Private team messenger',
  primaryColor: '#2563eb',
  logoUrl: null,
  customEmojis: [],
};

const WorkspaceContext = createContext<WorkspaceContextValue>({
  ...defaultBranding,
  refresh: async () => undefined,
});

function applyBrandColor(color: string) {
  document.documentElement.style.setProperty('--brand', color);
}

function normalizeBranding(data: Partial<WorkspaceBranding>): WorkspaceBranding {
  return {
    appName: data.appName?.trim() || defaultBranding.appName,
    tagline: data.tagline?.trim() || defaultBranding.tagline,
    primaryColor: data.primaryColor?.trim() || defaultBranding.primaryColor,
    logoUrl: data.logoUrl ?? null,
    customEmojis: Array.isArray(data.customEmojis) ? data.customEmojis : [],
  };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const organizationId = session?.activeOrganizationId ?? null;
  const [branding, setBranding] = useState<WorkspaceBranding>(defaultBranding);

  const refresh = useCallback(async () => {
    if (!organizationId) {
      setBranding(defaultBranding);
      applyBrandColor(defaultBranding.primaryColor);
      return;
    }
    try {
      const response = await api<WorkspaceBranding>('/workspace/settings');
      const next = normalizeBranding(response.data);
      setBranding(next);
      applyBrandColor(next.primaryColor);
    } catch {
      setBranding(defaultBranding);
      applyBrandColor(defaultBranding.primaryColor);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) {
      setBranding(defaultBranding);
      applyBrandColor(defaultBranding.primaryColor);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await api<WorkspaceBranding>('/workspace/settings');
        if (cancelled) {
          return;
        }
        const next = normalizeBranding(response.data);
        setBranding(next);
        applyBrandColor(next.primaryColor);
      } catch {
        if (cancelled) {
          return;
        }
        setBranding(defaultBranding);
        applyBrandColor(defaultBranding.primaryColor);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const value = useMemo(
    () => ({ ...branding, refresh }),
    [branding, refresh],
  );
  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
