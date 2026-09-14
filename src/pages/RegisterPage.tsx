import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSession } from '../auth/session';
import { PasswordInput } from '../components/PasswordInput';
import {
  hasFieldErrors,
  validateRegister,
  type FieldErrors,
  type RegisterFields,
} from '../lib/authValidation';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const inviteToken =
    (location.state as { inviteToken?: string } | null)?.inviteToken ??
    searchParams.get('inviteToken') ??
    undefined;
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<keyof RegisterFields>
  >({});
  const [busy, setBusy] = useState(false);

  function clearField(field: keyof RegisterFields) {
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
    const fields: RegisterFields = {
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const nextErrors = validateRegister(fields);
    setFieldErrors(nextErrors);
    if (hasFieldErrors(nextErrors)) return;

    setBusy(true);
    try {
      await register({
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        email: fields.email.trim().toLowerCase(),
        password: fields.password,
        inviteToken,
      });
      const next = getSession();
      navigate(
        next?.organizations.length && next.activeOrganizationId
          ? '/chat'
          : '/onboarding',
        { replace: true },
      );
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
        {inviteToken ? <p className="invite-badge">Workspace invitation</p> : null}
        <p className="muted auth-lead">
          Password needs 8+ characters with upper, lower, a number, and a symbol.
        </p>
        <form
          className="auth-form"
          noValidate
          onSubmit={(event) => void onSubmit(event)}
        >
          <label className={fieldErrors.firstName ? 'field-invalid' : undefined}>
            First name
            <input
              name="firstName"
              autoComplete="given-name"
              maxLength={80}
              className={fieldErrors.firstName ? 'input-invalid' : undefined}
              aria-invalid={fieldErrors.firstName ? true : undefined}
              aria-describedby={
                fieldErrors.firstName ? 'register-firstName-error' : undefined
              }
              onChange={() => clearField('firstName')}
            />
            {fieldErrors.firstName ? (
              <span
                className="field-error"
                id="register-firstName-error"
                role="alert"
              >
                {fieldErrors.firstName}
              </span>
            ) : null}
          </label>
          <label className={fieldErrors.lastName ? 'field-invalid' : undefined}>
            Last name
            <input
              name="lastName"
              autoComplete="family-name"
              maxLength={80}
              className={fieldErrors.lastName ? 'input-invalid' : undefined}
              aria-invalid={fieldErrors.lastName ? true : undefined}
              aria-describedby={
                fieldErrors.lastName ? 'register-lastName-error' : undefined
              }
              onChange={() => clearField('lastName')}
            />
            {fieldErrors.lastName ? (
              <span
                className="field-error"
                id="register-lastName-error"
                role="alert"
              >
                {fieldErrors.lastName}
              </span>
            ) : null}
          </label>
          <label className={fieldErrors.email ? 'field-invalid' : undefined}>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              className={fieldErrors.email ? 'input-invalid' : undefined}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={
                fieldErrors.email ? 'register-email-error' : undefined
              }
              onChange={() => clearField('email')}
            />
            {fieldErrors.email ? (
              <span className="field-error" id="register-email-error" role="alert">
                {fieldErrors.email}
              </span>
            ) : null}
          </label>
          <PasswordInput
            label="Password"
            name="password"
            autoComplete="new-password"
            maxLength={72}
            error={fieldErrors.password}
            onChange={() => clearField('password')}
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
