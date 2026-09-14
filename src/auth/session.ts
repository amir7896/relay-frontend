import type { OrganizationView } from '../api/types';

const SESSION_KEY = 'ms-frontend-session';

export type Session = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    isEmailVerified?: boolean;
  };
  organizations: OrganizationView[];
  activeOrganizationId: string | null;
};

export function getSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.user) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      user: parsed.user,
      organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [],
      activeOrganizationId: parsed.activeOrganizationId ?? null,
    };
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function setSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getAccessToken(): string | null {
  return getSession()?.accessToken ?? null;
}
