import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { session } = useAuth();
  const [status, setStatus] = useState<'busy' | 'success' | 'error'>(token ? 'busy' : 'error');
  const [message, setMessage] = useState(token ? 'Verifying your email…' : 'This verification link is missing its token.');

  useEffect(() => {
    if (!token) return;
    void api('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setStatus('success');
        setMessage('Your email has been verified.');
      })
      .catch((err: unknown) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Could not verify email');
      });
  }, [token]);

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <p className="eyebrow">Email verification</p>
        <h1>{status === 'success' ? 'Email verified' : 'Verify your email'}</h1>
        <p className={status === 'error' ? 'error' : status === 'success' ? 'ok' : 'muted'}>
          {message}
        </p>
        {status === 'success' ? (
          <Link className="btn lg full auth-action-link" to={session ? '/chat' : '/login'}>
            {session ? 'Continue to chat' : 'Sign in'}
          </Link>
        ) : null}
        {status === 'error' ? <p className="switch"><Link to="/login">Go to sign in</Link></p> : null}
      </div>
    </main>
  );
}
