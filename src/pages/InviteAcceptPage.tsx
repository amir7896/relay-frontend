import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import {
  hasFieldErrors,
  validateRegister,
  type FieldErrors,
  type RegisterFields,
} from '../lib/authValidation';

type PublicInvite = { email: string | null; expiresAt: string; valid: boolean };

export function InviteAcceptPage() {
  const { token = '' } = useParams();
  const { register } = useAuth();
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
      await register({
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        email: fields.email.trim().toLowerCase(),
        password: fields.password,
        inviteToken: token,
      });
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="auth-page"><div className="auth-panel"><p className="muted">Checking invitation…</p></div></main>;
  if (error || !invite?.valid) {
    return <main className="auth-page"><div className="auth-panel"><h1>Invitation unavailable</h1><p className="error">{error || 'This invitation is expired, revoked, or fully used.'}</p><p className="switch"><Link to="/login">Go to sign in</Link></p></div></main>;
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">Workspace invitation</p>
        <h1>Join Relay</h1>
        <p className="invite-badge">Invitation valid until {new Date(invite.expiresAt).toLocaleDateString()}</p>
        <form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}>
          {(['firstName', 'lastName'] as const).map((name) => (
            <label key={name} className={fieldErrors[name] ? 'field-invalid' : undefined}>
              {name === 'firstName' ? 'First name' : 'Last name'}
              <input name={name} autoComplete={name === 'firstName' ? 'given-name' : 'family-name'} />
              {fieldErrors[name] ? <span className="field-error">{fieldErrors[name]}</span> : null}
            </label>
          ))}
          <label className={fieldErrors.email ? 'field-invalid' : undefined}>
            Email
            <input name="email" type="email" defaultValue={invite.email ?? ''} readOnly={Boolean(invite.email)} autoComplete="email" />
            {fieldErrors.email ? <span className="field-error">{fieldErrors.email}</span> : null}
          </label>
          <PasswordInput label="Password" name="password" autoComplete="new-password" maxLength={72} error={fieldErrors.password} />
          {error ? <p className="error">{error}</p> : null}
          <button className="btn lg full" disabled={busy} type="submit">{busy ? 'Joining…' : 'Accept invitation'}</button>
        </form>
        <p className="switch">Already registered? <Link to="/login">Sign in</Link></p>
      </div>
    </main>
  );
}
