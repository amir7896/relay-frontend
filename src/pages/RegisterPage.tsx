import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await register({
        firstName: String(form.get('firstName')),
        lastName: String(form.get('lastName')),
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">Join Relay</p>
        <h1>Create your account</h1>
        <p className="muted auth-lead">
          Password needs 8+ characters with upper, lower, a number, and a symbol.
        </p>
        <form className="auth-form" onSubmit={(event) => void onSubmit(event)}>
          <label>
            First name
            <input name="firstName" autoComplete="given-name" required maxLength={80} />
          </label>
          <label>
            Last name
            <input name="lastName" autoComplete="family-name" required maxLength={80} />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <PasswordInput
            label="Password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
          {error ? <p className="error">{error}</p> : null}
          <button className="btn lg full" disabled={busy} type="submit">
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
