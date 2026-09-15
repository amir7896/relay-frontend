import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AuthUser, OrganizationView } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { setSession } from '../auth/session';

/** Completes browser OIDC redirect from the API gateway. */
export function SsoCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { replaceSession } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');
    const organizationId = searchParams.get('organizationId');
    const returnPathRaw = searchParams.get('returnPath') || '/chat';
    const returnPath =
      returnPathRaw.startsWith('/') && !returnPathRaw.startsWith('//')
        ? returnPathRaw
        : '/chat';

    if (!accessToken || !refreshToken) {
      setError('SSO callback missing tokens');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        setSession({
          accessToken,
          refreshToken,
          user: {
            id: '',
            email: '',
            role: 'user',
            isEmailVerified: true,
          },
          organizations: [],
          activeOrganizationId: organizationId,
        });
        const [me, orgs] = await Promise.all([
          api<AuthUser>('/auth/me'),
          api<OrganizationView[]>('/organizations'),
        ]);
        if (cancelled) {
          return;
        }
        const next = {
          accessToken,
          refreshToken,
          user: {
            id: me.data.id,
            email: me.data.email,
            role: me.data.role,
            isEmailVerified: me.data.isEmailVerified,
            totpEnabled: Boolean(me.data.totpEnabled),
          },
          organizations: orgs.data,
          activeOrganizationId:
            organizationId &&
            orgs.data.some((org) => org.id === organizationId)
              ? organizationId
              : orgs.data[0]?.id ?? null,
        };
        replaceSession(next);
        navigate(returnPath, { replace: true });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'SSO sign-in failed');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate, replaceSession]);

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">SSO</p>
        <h1>Signing you in…</h1>
        {error ? (
          <>
            <p className="error">{error}</p>
            <p className="muted">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <p className="muted">Completing workspace SSO</p>
        )}
      </div>
    </main>
  );
}
