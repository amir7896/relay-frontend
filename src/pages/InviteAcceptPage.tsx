import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../auth/session';
import { PasswordInput } from '../components/PasswordInput';
import {
  hasFieldErrors,
  validateRegister,
  type FieldErrors,
  type RegisterFields,
} from '../lib/authValidation';
import type { OrganizationView } from '../api/types';

type PublicInvite = {
  email: string | null;
  expiresAt: string;
  valid: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
  pendingChannelId?: string | null;
};

type AcceptInviteResult = {
  organizationId: string;
  organizations: OrganizationView[];
  activeOrganizationId: string;
  alreadyMember: boolean;
  pendingChannelId?: string | null;
};

export function InviteAcceptPage() {
  const { token = '' } = useParams();
  const { register, session, replaceSession, logout } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof RegisterFields>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<PublicInvite>(`/auth/invites/${encodeURIComponent(token)}`)
      .then((response) => setInvite(response.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Invitation unavailable'))
      .finally(() => setLoading(false));
  }, [token]);

  async function switchToInviteAccount() {
    setBusy(true);
    setError('');
    try {
      await logout();
      const params = new URLSearchParams();
      params.set('inviteToken', token);
      if (invite?.email) {
        params.set('email', invite.email);
      }
      navigate(`/login?${params.toString()}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out');
      setBusy(false);
    }
  }

  async function acceptWhileSignedIn() {
    setBusy(true);
    setError('');
    try {
      const response = await api<AcceptInviteResult>(
        `/auth/invites/${encodeURIComponent(token)}/accept`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      const current = getSession();
      if (current) {
        replaceSession({
          ...current,
          organizations: response.data.organizations,
          activeOrganizationId: response.data.activeOrganizationId,
        });
      }
      const channelId = response.data.pendingChannelId;
      navigate(
        channelId ? `/chat/${channelId}` : '/chat',
        { replace: true },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields: RegisterFields = {
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      email: invite?.email ?? String(form.get('email') ?? ''),
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
      const next = getSession();
      const channelId =
        registered.pendingChannelId || invite?.pendingChannelId || null;
      if (channelId) {
        navigate(`/chat/${channelId}`, { replace: true });
      } else {
        navigate(
          next?.organizations.length && next.activeOrganizationId
            ? '/chat'
            : '/onboarding',
          { replace: true },
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="auth-page">
        <div className="auth-panel">
          <p className="muted">Checking invitation…</p>
        </div>
      </main>
    );
  }
  if (error && !invite?.valid) {
    return (
      <main className="auth-page">
        <div className="auth-panel">
          <h1>Invitation unavailable</h1>
          <p className="error">{error || 'This invitation is expired, revoked, or fully used.'}</p>
          <p className="switch">
            <Link to="/login">Go to sign in</Link>
          </p>
        </div>
      </main>
    );
  }
  if (!invite?.valid) {
    return (
      <main className="auth-page">
        <div className="auth-panel">
          <h1>Invitation unavailable</h1>
          <p className="error">This invitation is expired, revoked, or fully used.</p>
          <p className="switch">
            <Link to="/login">Go to sign in</Link>
          </p>
        </div>
      </main>
    );
  }

  const signedIn = Boolean(session?.accessToken);
  const emailMismatch =
    signedIn &&
    invite.email &&
    session?.user.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">
          {invite.pendingChannelId ? 'Channel invitation' : 'Workspace invitation'}
        </p>
        <h1>Join {invite.organizationName ?? 'the workspace'}</h1>
        <p className="invite-badge">
          Invitation valid until {new Date(invite.expiresAt).toLocaleDateString()}
        </p>

        {signedIn ? (
          <>
            <p className="muted auth-lead">
              Signed in as <strong>{session?.user.email}</strong>. Join{' '}
              <strong>{invite.organizationName ?? 'this workspace'}</strong>
              {invite.pendingChannelId
                ? ' and you will be added to the invited channel automatically.'
                : ' and start in #general.'}
            </p>
            {emailMismatch ? (
              <>
                <p className="error">
                  This invite is for <strong>{invite.email}</strong>, but you are
                  signed in as <strong>{session?.user.email}</strong>.
                </p>
                {error ? <p className="error">{error}</p> : null}
                <button
                  className="btn lg full"
                  type="button"
                  disabled={busy}
                  onClick={() => void switchToInviteAccount()}
                >
                  {busy
                    ? 'Signing out…'
                    : `Sign out & continue as ${invite.email}`}
                </button>
                <p className="switch">
                  Or{' '}
                  <button
                    type="button"
                    className="linkish"
                    disabled={busy}
                    onClick={() => void switchToInviteAccount()}
                  >
                    create / sign in with that email
                  </button>
                </p>
              </>
            ) : (
              <>
                {error ? <p className="error">{error}</p> : null}
                <button
                  className="btn lg full"
                  type="button"
                  disabled={busy}
                  onClick={() => void acceptWhileSignedIn()}
                >
                  {busy ? 'Joining…' : 'Join workspace'}
                </button>
                <p className="switch">
                  Wrong account?{' '}
                  <button
                    type="button"
                    className="linkish"
                    disabled={busy}
                    onClick={() => void switchToInviteAccount()}
                  >
                    Sign in with another email
                  </button>
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <p className="muted auth-lead">
              Create your account to join{' '}
              <strong>{invite.organizationName ?? 'this workspace'}</strong> and
              start in <strong>#general</strong>.
            </p>
            <form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}>
              {(['firstName', 'lastName'] as const).map((name) => (
                <label key={name} className={fieldErrors[name] ? 'field-invalid' : undefined}>
                  {name === 'firstName' ? 'First name' : 'Last name'}
                  <input
                    name={name}
                    autoComplete={name === 'firstName' ? 'given-name' : 'family-name'}
                  />
                  {fieldErrors[name] ? (
                    <span className="field-error">{fieldErrors[name]}</span>
                  ) : null}
                </label>
              ))}
              <label className={fieldErrors.email ? 'field-invalid' : undefined}>
                Email
                <input
                  name="email"
                  type="email"
                  defaultValue={invite.email ?? ''}
                  readOnly={Boolean(invite.email)}
                  autoComplete="email"
                />
                {fieldErrors.email ? (
                  <span className="field-error">{fieldErrors.email}</span>
                ) : null}
              </label>
              <PasswordInput
                label="Password"
                name="password"
                autoComplete="new-password"
                maxLength={72}
                error={fieldErrors.password}
              />
              {error ? <p className="error">{error}</p> : null}
              <button className="btn lg full" disabled={busy} type="submit">
                {busy ? 'Joining…' : 'Accept invitation'}
              </button>
            </form>
            <p className="switch">
              Already registered?{' '}
              <Link to={`/login?inviteToken=${encodeURIComponent(token)}`}>
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
