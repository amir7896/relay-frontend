import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../auth/session';
import { PasswordInput } from '../components/PasswordInput';
import {
  hasFieldErrors,
  validateLogin,
  type FieldErrors,
  type LoginFields,
} from '../lib/authValidation';

export function LoginPage() {
  const { login, verify2faLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('inviteToken');
  const inviteEmailHint = searchParams.get('email') ?? '';
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof LoginFields>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [pending2fa, setPending2fa] = useState<{
    tempToken: string;
    email: string;
  } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [emailDraft, setEmailDraft] = useState(inviteEmailHint);

  useEffect(() => {
    if (inviteEmailHint) {
      setEmailDraft(inviteEmailHint);
    }
  }, [inviteEmailHint]);
  const fromRaw = (location.state as { from?: string } | null)?.from;
  const from =
    inviteToken
      ? `/invite/${inviteToken}`
      : fromRaw &&
          String(fromRaw).startsWith('/') &&
          fromRaw !== '/onboarding'
        ? String(fromRaw)
        : '/chat';

  function clearField(field: keyof LoginFields) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function goAfterAuth() {
    const next = getSession();
    navigate(
      next?.organizations.length && next.activeOrganizationId
        ? from
        : '/onboarding',
      { replace: true },
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const fields: LoginFields = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const nextErrors = validateLogin(fields);
    setFieldErrors(nextErrors);
    if (hasFieldErrors(nextErrors)) return;

    setBusy(true);
    try {
      const result = await login(
        fields.email.trim().toLowerCase(),
        fields.password,
      );
      if (result?.requires2fa) {
        setPending2fa({
          tempToken: result.tempToken,
          email: result.email,
        });
        return;
      }
      goAfterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify2fa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending2fa) return;
    setError('');
    setBusy(true);
    try {
      await verify2faLogin(pending2fa.tempToken, otpCode.trim());
      goAfterAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid authenticator code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">Welcome back</p>
        <h1>Sign in to Relay</h1>
        {pending2fa ? (
          <>
            <p className="muted auth-lead">
              Enter the 6-digit code from your authenticator app for{' '}
              <strong>{pending2fa.email}</strong>.
            </p>
            <form
              className="auth-form"
              noValidate
              onSubmit={(event) => void onVerify2fa(event)}
            >
              <label>
                Authenticator code
                <input
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value)}
                  required
                />
              </label>
              {error ? <p className="error">{error}</p> : null}
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Verifying…' : 'Verify and continue'}
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setPending2fa(null);
                  setOtpCode('');
                  setError('');
                }}
              >
                Back
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="muted auth-lead">
              Use the email and password for your Relay account.
            </p>
            <form
              className="auth-form"
              noValidate
              onSubmit={(event) => void onSubmit(event)}
            >
              <label className={fieldErrors.email ? 'field-invalid' : undefined}>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={emailDraft}
                  className={fieldErrors.email ? 'input-invalid' : undefined}
                  aria-invalid={fieldErrors.email ? true : undefined}
                  aria-describedby={
                    fieldErrors.email ? 'login-email-error' : undefined
                  }
                  onChange={(event) => {
                    setEmailDraft(event.target.value);
                    clearField('email');
                  }}
                />
                {fieldErrors.email ? (
                  <span className="field-error" id="login-email-error" role="alert">
                    {fieldErrors.email}
                  </span>
                ) : null}
              </label>
              <PasswordInput
                name="password"
                label="Password"
                autoComplete="current-password"
                error={fieldErrors.password}
                onChange={() => clearField('password')}
              />
              {error ? <p className="error">{error}</p> : null}
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <div className="auth-divider">
              <span>or</span>
            </div>
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                setError('');
                const slug = new FormData(event.currentTarget)
                  .get('workspaceSlug')
                  ?.toString()
                  .trim()
                  .toLowerCase();
                if (!slug) {
                  setError('Enter your workspace slug to continue with SSO');
                  return;
                }
                setBusy(true);
                void api<{
                  organizationId: string;
                  configured: boolean;
                  name: string;
                }>('/auth/sso/status?slug=' + encodeURIComponent(slug))
                  .then((response) => {
                    if (!response.data.configured) {
                      throw new Error(
                        `SSO is not configured for ${response.data.name || slug}`,
                      );
                    }
                    window.location.href = `/api/auth/sso/${response.data.organizationId}/start?returnPath=${encodeURIComponent(from)}`;
                  })
                  .catch((err) => {
                    setError(
                      err instanceof Error
                        ? err.message
                        : 'Could not start SSO',
                    );
                    setBusy(false);
                  });
              }}
            >
              <label>
                Workspace slug (SSO)
                <input
                  name="workspaceSlug"
                  placeholder="acme"
                  autoComplete="organization"
                />
              </label>
              <button className="ghost" type="submit" disabled={busy}>
                Continue with SSO
              </button>
            </form>
            <p className="muted auth-alt">
              <Link to="/forgot-password">Forgot password?</Link>
              {' · '}
              <Link to={inviteToken ? `/register?inviteToken=${inviteToken}` : '/register'}>
                Create account
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
