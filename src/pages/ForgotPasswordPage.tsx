import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { validateEmail } from '../lib/authValidation';

export function ForgotPasswordPage() {
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [success, setSuccess] = useState('');
  const [debugResetUrl, setDebugResetUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    const validation = validateEmail(email);
    setFieldError(validation ?? '');
    setError('');
    setSuccess('');
    setDebugResetUrl('');
    if (validation) return;
    setBusy(true);
    try {
      const response = await api<{ debugResetUrl?: string }>(
        '/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        },
      );
      setSuccess(
        'If an account exists for that email, we sent a password reset link. Check your inbox and spam folder.',
      );
      setDebugResetUrl(response.data.debugResetUrl ?? '');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not request a reset link',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">Account recovery</p>
        <h1>Forgot your password?</h1>
        <p className="muted auth-lead">
          Enter the email on your Relay account and we&apos;ll send a secure
          link to choose a new password.
        </p>
        <form
          className="auth-form"
          noValidate
          onSubmit={(event) => void onSubmit(event)}
        >
          <label className={fieldError ? 'field-invalid' : undefined}>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              className={fieldError ? 'input-invalid' : undefined}
              onChange={() => setFieldError('')}
            />
            {fieldError ? (
              <span className="field-error">{fieldError}</span>
            ) : null}
          </label>
          {error ? <p className="error">{error}</p> : null}
          {success ? <p className="ok">{success}</p> : null}
          {debugResetUrl ? (
            <p className="muted">
              SMTP is not configured locally —{' '}
              <a className="debug-link" href={debugResetUrl}>
                open the reset link
              </a>
              .
            </p>
          ) : null}
          <button className="btn lg full" disabled={busy} type="submit">
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className="switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
