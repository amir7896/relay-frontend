import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { getSession } from '../../auth/session';
import { PasswordInput } from '../../components/PasswordInput';
import {
  hasFieldErrors,
  validateRegister,
  type FieldErrors,
  type RegisterFields,
} from '../../lib/authValidation';
import type { OrganizationView } from '../../api/types';

type ConnectInvitePreview = {
  valid: boolean;
  message?: string;
  email: string | null;
  conversationId: string | null;
  conversationName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  status?: 'pending' | 'accepted' | 'revoked';
};

type AcceptConnectResult = {
  organizationId: string;
  conversationId: string | null;
  role?: string;
  organizations?: OrganizationView[];
  activeOrganizationId?: string;
};

type AcceptInviteResult = {
  organizationId: string;
  organizations: OrganizationView[];
  activeOrganizationId: string;
  pendingChannelId?: string | null;
};

export function ConnectAcceptPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { register, session, replaceSession, logout } = useAuth();
  const [preview, setPreview] = useState<ConnectInvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof RegisterFields>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await api<ConnectInvitePreview>(
          `/chat/connect/invites/${encodeURIComponent(token)}`,
        );
        if (cancelled) return;
        setPreview(response.data);
        if (!response.data.valid) {
          setError(response.data.message || 'This Connect invite is no longer valid');
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Could not load Connect invite',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (token) void load();
    else {
      setError('Invite token is missing');
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function finishJoin(
    organizationId: string,
    conversationId: string | null,
    organizations?: OrganizationView[],
    activeOrganizationId?: string,
  ) {
    const current = getSession();
    if (current && organizationId) {
      replaceSession({
        ...current,
        organizations:
          organizations && organizations.length > 0
            ? organizations
            : current.organizations,
        activeOrganizationId: activeOrganizationId || organizationId,
      });
    }
    navigate(conversationId ? `/chat/${conversationId}` : '/chat', {
      replace: true,
    });
  }

  async function acceptWhileSignedIn() {
    if (!session) {
      navigate('/login', {
        replace: false,
        state: { from: `/connect-invite/${token}` },
      });
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api<AcceptConnectResult>(
        `/chat/connect/invites/${encodeURIComponent(token)}/accept`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      await finishJoin(
        response.data.organizationId,
        response.data.conversationId,
        response.data.organizations,
        response.data.activeOrganizationId,
      );
    } catch (err) {
      // Fallback: workspace invite accept path (same token).
      try {
        const joined = await api<AcceptInviteResult>(
          `/auth/invites/${encodeURIComponent(token)}/accept`,
          { method: 'POST', body: JSON.stringify({}) },
        );
        const current = getSession();
        if (current) {
          replaceSession({
            ...current,
            organizations: joined.data.organizations,
            activeOrganizationId: joined.data.activeOrganizationId,
          });
        }
        navigate(
          joined.data.pendingChannelId
            ? `/chat/${joined.data.pendingChannelId}`
            : '/chat',
          { replace: true },
        );
      } catch {
        setError(
          err instanceof Error ? err.message : 'Could not join shared channel',
        );
        setBusy(false);
      }
    }
  }

  async function switchAccount() {
    setBusy(true);
    setError('');
    try {
      await logout();
      const params = new URLSearchParams();
      params.set('inviteToken', token);
      if (preview?.email) params.set('email', preview.email);
      navigate(`/login?${params.toString()}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out');
      setBusy(false);
    }
  }

  async function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields: RegisterFields = {
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      email: preview?.email ?? String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const nextErrors = validateRegister(fields);
    setFieldErrors(nextErrors);
    setError('');
    if (hasFieldErrors(nextErrors)) return;
    setBusy(true);
    try {
      const registered = await register({
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        email: fields.email.trim().toLowerCase(),
        password: fields.password,
        inviteToken: token,
      });
      const channelId =
        registered.pendingChannelId || preview?.conversationId || null;
      navigate(channelId ? `/chat/${channelId}` : '/chat', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account');
      setBusy(false);
    }
  }

  const channelLabel = preview?.conversationName
    ? `#${preview.conversationName}`
    : 'a shared channel';
  const workspaceLabel = preview?.organizationName || 'another workspace';

  return (
    <main className="auth-page">
      <div className="auth-panel channel-invite-panel">
        <p className="eyebrow">Slack Connect</p>
        <h1>Join {channelLabel}</h1>
        {loading ? <p className="muted">Checking invite…</p> : null}
        {!loading && preview?.valid ? (
          <>
            <p className="muted">
              You&apos;ve been invited to collaborate in {channelLabel} on{' '}
              {workspaceLabel} as a guest.
              {preview.email ? ` This invite is for ${preview.email}.` : ''}
            </p>
            {session ? (
              <>
                <div className="modal-actions">
                  <button
                    className="btn full"
                    type="button"
                    disabled={busy}
                    onClick={() => void acceptWhileSignedIn()}
                  >
                    {busy ? 'Joining…' : `Join ${channelLabel}`}
                  </button>
                </div>
                <p className="muted">
                  Signed in as {session.user.email}.{' '}
                  <button
                    type="button"
                    className="linkish"
                    disabled={busy}
                    onClick={() => void switchAccount()}
                  >
                    Use a different account
                  </button>
                </p>
              </>
            ) : (
              <form className="auth-form" onSubmit={onRegister}>
                <label>
                  First name
                  <input name="firstName" autoComplete="given-name" required />
                  {fieldErrors.firstName ? (
                    <span className="field-error">{fieldErrors.firstName}</span>
                  ) : null}
                </label>
                <label>
                  Last name
                  <input name="lastName" autoComplete="family-name" required />
                  {fieldErrors.lastName ? (
                    <span className="field-error">{fieldErrors.lastName}</span>
                  ) : null}
                </label>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    defaultValue={preview.email ?? ''}
                    readOnly={Boolean(preview.email)}
                    required
                  />
                </label>
                <PasswordInput
                  label="Password"
                  name="password"
                  autoComplete="new-password"
                  maxLength={72}
                  error={fieldErrors.password}
                />
                <button className="btn full" type="submit" disabled={busy}>
                  {busy ? 'Creating account…' : 'Create account & join'}
                </button>
                <p className="muted">
                  Already have an account?{' '}
                  <Link to={`/login?inviteToken=${encodeURIComponent(token)}`}>
                    Sign in
                  </Link>
                </p>
              </form>
            )}
          </>
        ) : null}
        {error ? (
          <>
            <p className="error">{error}</p>
            <p>
              <Link to={session ? '/chat' : '/login'}>
                {session ? 'Back to chat' : 'Go to login'}
              </Link>
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
