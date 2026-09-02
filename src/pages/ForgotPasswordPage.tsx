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
    if (validation) return;
    setBusy(true);
    try {
      const response = await api<{ debugResetUrl?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setSuccess('If an account exists for that email, a reset link has been sent.');
      setDebugResetUrl(response.data.debugResetUrl ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a reset link');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">Account recovery</p>
        <h1>Reset your password</h1>
        <p className="muted auth-lead">Enter your account email and we’ll send you a reset link.</p>
        <form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}>
          <label className={fieldError ? 'field-invalid' : undefined}>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              className={fieldError ? 'input-invalid' : undefined}
              onChange={() => setFieldError('')}
            />
            {fieldError ? <span className="field-error">{fieldError}</span> : null}
          </label>
          {error ? <p className="error">{error}</p> : null}
          {success ? <p className="ok">{success}</p> : null}
          {debugResetUrl ? <a className="debug-link" href={debugResetUrl}>Open local reset link</a> : null}
          <button className="btn lg full" disabled={busy} type="submit">
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className="switch"><Link to="/login">Back to sign in</Link></p>
      </div>
    </main>
  );
}
