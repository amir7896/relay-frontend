import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import {
  hasFieldErrors,
  validateLogin,
  type FieldErrors,
  type LoginFields,
} from '../lib/authValidation';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<keyof LoginFields>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const from =
    (location.state as { from?: string } | null)?.from &&
    String((location.state as { from: string }).from).startsWith('/')
      ? (location.state as { from: string }).from
      : '/chat';

  function clearField(field: keyof LoginFields) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
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
      await login(fields.email.trim().toLowerCase(), fields.password);
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
              className={fieldErrors.email ? 'input-invalid' : undefined}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
              onChange={() => clearField('email')}
            />
            {fieldErrors.email ? (
              <span className="field-error" id="login-email-error" role="alert">
                {fieldErrors.email}
              </span>
            ) : null}
          </label>
          <PasswordInput
            label="Password"
            name="password"
            autoComplete="current-password"
            error={fieldErrors.password}
            onChange={() => clearField('password')}
          />
          <Link className="auth-help-link" to="/forgot-password">
            Forgot password?
          </Link>
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
