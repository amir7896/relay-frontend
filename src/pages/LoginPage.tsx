import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const from =
    (location.state as { from?: string } | null)?.from &&
    String((location.state as { from: string }).from).startsWith('/')
      ? (location.state as { from: string }).from
      : '/chat';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await login(String(form.get('email')), String(form.get('password')));
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">Welcome back</p>
        <h1>Sign in to Relay</h1>
        <p className="muted auth-lead">Use the email and password for your Relay account.</p>
        <form className="auth-form" onSubmit={(event) => void onSubmit(event)}>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <PasswordInput
            label="Password"
            name="password"
            autoComplete="current-password"
            required
          />
          {error ? <p className="error">{error}</p> : null}
          <button className="btn lg full" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="switch">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
