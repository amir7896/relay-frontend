import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export type WorkspaceBranding = {
  appName: string;
  tagline: string;
  primaryColor: string;
  logoUrl: string | null;
};

const defaultBranding: WorkspaceBranding = {
  appName: 'Relay',
  tagline: 'Private team messenger',
  primaryColor: '#2563eb',
  logoUrl: null,
};

const WorkspaceContext = createContext<WorkspaceBranding>(defaultBranding);

function applyBrandColor(color: string) {
  document.documentElement.style.setProperty('--brand', color);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const organizationId = session?.activeOrganizationId ?? null;
  const [branding, setBranding] = useState<WorkspaceBranding>(defaultBranding);

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
        setBranding(response.data);
        applyBrandColor(response.data.primaryColor);
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

  const value = useMemo(() => branding, [branding]);
  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
