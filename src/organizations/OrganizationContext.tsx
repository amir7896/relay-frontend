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
import type { OrganizationView } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../auth/session';

type DeleteOrganizationResult = {
  deletedOrganizationId: string;
  remainingOrganizations: OrganizationView[];
};

type LeaveOrganizationResult = {
  leftOrganizationId: string;
  remainingOrganizations: OrganizationView[];
};

type OrganizationContextValue = {
  organizations: OrganizationView[];
  activeOrganizationId: string | null;
  switchOrganization: (id: string) => void;
  createOrganization: (name: string, slug?: string) => Promise<void>;
  deleteOrganization: (organizationId: string, confirmName: string) => Promise<void>;
  leaveOrganization: (organizationId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
};

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { session, replaceSession } = useAuth();
  const [busy, setBusy] = useState(false);

  const organizations = session?.organizations ?? [];
  const activeOrganizationId = session?.activeOrganizationId ?? null;

  const refreshOrganizations = useCallback(async () => {
    const current = getSession();
    if (!current?.accessToken) {
      return;
    }
    try {
      const response = await api<OrganizationView[]>('/organizations');
      const nextOrgs = response.data ?? [];
      const stillValid =
        current.activeOrganizationId &&
        nextOrgs.some((org) => org.id === current.activeOrganizationId);
      replaceSession({
        ...current,
        organizations: nextOrgs,
        activeOrganizationId: stillValid
          ? current.activeOrganizationId
          : (nextOrgs[0]?.id ?? null),
      });
    } catch {
      // Keep cached session orgs if the list call fails.
    }
  }, [replaceSession]);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }
    void refreshOrganizations();
  }, [session?.accessToken, refreshOrganizations]);

  const switchOrganization = useCallback(
    (id: string) => {
      const current = getSession();
      if (!current || current.activeOrganizationId === id) {
        return;
      }
      if (!current.organizations.some((org) => org.id === id)) {
        return;
      }
      replaceSession({ ...current, activeOrganizationId: id });
      window.location.assign('/chat');
    },
    [replaceSession],
  );

  const createOrganization = useCallback(
    async (name: string, slug?: string) => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        const trimmedName = name.trim();
        const trimmedSlug = slug?.trim();
        const response = await api<OrganizationView>('/organizations', {
          method: 'POST',
          body: JSON.stringify({
            name: trimmedName,
            ...(trimmedSlug ? { slug: trimmedSlug } : {}),
          }),
        });
        const created = response.data;
        const current = getSession();
        if (!current) {
          return;
        }
        const withoutDup = current.organizations.filter((org) => org.id !== created.id);
        replaceSession({
          ...current,
          organizations: [...withoutDup, created],
          activeOrganizationId: created.id,
        });
        window.location.assign('/chat');
      } finally {
        setBusy(false);
      }
    },
    [busy, replaceSession],
  );

  const deleteOrganization = useCallback(
    async (organizationId: string, confirmName: string) => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        const response = await api<DeleteOrganizationResult>(
          `/organizations/${organizationId}`,
          {
            method: 'DELETE',
            body: JSON.stringify({ confirmName }),
          },
        );
        const current = getSession();
        if (!current) {
          return;
        }
        const remaining =
          response.data.remainingOrganizations ??
          current.organizations.filter((org) => org.id !== organizationId);
        const nextActive =
          remaining.find((org) => org.id === current.activeOrganizationId)?.id ??
          remaining[0]?.id ??
          null;
        replaceSession({
          ...current,
          organizations: remaining,
          activeOrganizationId: nextActive,
        });
        window.location.assign(nextActive ? '/chat' : '/onboarding');
      } finally {
        setBusy(false);
      }
    },
    [busy, replaceSession],
  );

  const leaveOrganization = useCallback(
    async (organizationId: string) => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        const response = await api<LeaveOrganizationResult>(
          `/organizations/${organizationId}/leave`,
          { method: 'POST', body: JSON.stringify({}) },
        );
        const current = getSession();
        if (!current) {
          return;
        }
        const remaining =
          response.data.remainingOrganizations ??
          current.organizations.filter((org) => org.id !== organizationId);
        const nextActive = remaining[0]?.id ?? null;
        replaceSession({
          ...current,
          organizations: remaining,
          activeOrganizationId: nextActive,
        });
        window.location.assign(nextActive ? '/chat' : '/onboarding');
      } finally {
        setBusy(false);
      }
    },
    [busy, replaceSession],
  );

  const value = useMemo(
    () => ({
      organizations,
      activeOrganizationId,
      switchOrganization,
      createOrganization,
      deleteOrganization,
      leaveOrganization,
      refreshOrganizations,
    }),
    [
      organizations,
      activeOrganizationId,
      switchOrganization,
      createOrganization,
      deleteOrganization,
      leaveOrganization,
      refreshOrganizations,
    ],
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization(): OrganizationContextValue {
  const value = useContext(OrganizationContext);
  if (!value) {
    throw new Error('useOrganization must be used inside OrganizationProvider');
  }
  return value;
}
