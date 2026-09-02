import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { PasswordInput } from '../components/PasswordInput';
import { validateRegisterPassword } from '../lib/authValidation';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    const validation = validateRegisterPassword(password);
    setFieldError(validation ?? '');
    setError('');
    if (!token || validation) return;
    setBusy(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">Account recovery</p>
        <h1>Choose a new password</h1>
        {!token ? <p className="error">This reset link is missing its token.</p> : null}
        {success ? (
          <>
            <p className="ok">Your password has been reset.</p>
            <p className="switch"><Link to="/login">Sign in with your new password</Link></p>
          </>
        ) : (
          <form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}>
            <PasswordInput
              label="New password"
              name="password"
              autoComplete="new-password"
              maxLength={72}
              error={fieldError}
              onChange={() => setFieldError('')}
            />
            {error ? <p className="error">{error}</p> : null}
            <button className="btn lg full" disabled={busy || !token} type="submit">
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        )}
        {!success ? <p className="switch"><Link to="/login">Back to sign in</Link></p> : null}
      </div>
    </main>
  );
}
