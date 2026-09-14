import { clearSession, getAccessToken, getSession, setSession } from '../auth/session';
import type { ApiEnvelope, AuthResult } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

function shouldAttachOrganizationHeader(path: string): boolean {
  // Workspace invite management needs the active org.
  if (path === '/auth/invites') {
    return true;
  }
  // DELETE /auth/invites/:inviteId (UUID)
  if (
    /^\/auth\/invites\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      path,
    )
  ) {
    return true;
  }
  return !path.startsWith('/auth/');
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  // FormData must set its own multipart boundary — never force JSON here.
  if (
    !headers.has('Content-Type') &&
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headers.set('Content-Type', 'application/json');
  }
  // ngrok free tier interstitial otherwise breaks JSON /api responses
  headers.set('ngrok-skip-browser-warning', 'true');
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const session = getSession();
  if (
    shouldAttachOrganizationHeader(path) &&
    session?.activeOrganizationId &&
    !headers.has('X-Organization-Id')
  ) {
    headers.set('X-Organization-Id', session.activeOrganizationId);
  }

  const response = await fetch(`/api${path}`, { ...init, headers });
  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | { message?: string }
    | null;

  if (response.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return api<T>(path, init);
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String(payload.message)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as ApiEnvelope<T>;
}

export async function refreshSession(): Promise<boolean> {
  const session = getSession();
  if (!session?.refreshToken) {
    return false;
  }
  try {
    const result = await api<AuthResult>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    const organizations = result.data.organizations ?? [];
    const stillValid =
      session.activeOrganizationId &&
      organizations.some((org) => org.id === session.activeOrganizationId);
    setSession({
      accessToken: result.data.tokens.accessToken,
      refreshToken: result.data.tokens.refreshToken,
      user: {
        id: result.data.user.id,
        email: result.data.user.email,
        role: result.data.user.role,
        isEmailVerified: result.data.user.isEmailVerified,
      },
      organizations,
      activeOrganizationId: stillValid
        ? session.activeOrganizationId
        : (result.data.activeOrganizationId ?? null),
    });
    return true;
  } catch {
    clearSession();
    return false;
  }
}
