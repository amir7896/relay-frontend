import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';

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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<WorkspaceBranding>(defaultBranding);

  useEffect(() => {
    void (async () => {
      try {
        const response = await api<WorkspaceBranding>('/workspace/settings');
        setBranding(response.data);
        document.documentElement.style.setProperty(
          '--brand',
          response.data.primaryColor,
        );
      } catch {
        document.documentElement.style.setProperty('--brand', defaultBranding.primaryColor);
      }
    })();
  }, []);

  const value = useMemo(() => branding, [branding]);
  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
