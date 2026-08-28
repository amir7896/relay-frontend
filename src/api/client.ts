import { clearSession, getAccessToken, getSession, setSession } from '../auth/session';
import type { ApiEnvelope } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
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
    const result = await api<{
      user: { id: string; email: string; role: string };
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    setSession({
      accessToken: result.data.tokens.accessToken,
      refreshToken: result.data.tokens.refreshToken,
      user: {
        id: result.data.user.id,
        email: result.data.user.email,
        role: result.data.user.role,
      },
    });
    return true;
  } catch {
    clearSession();
    return false;
  }
}
