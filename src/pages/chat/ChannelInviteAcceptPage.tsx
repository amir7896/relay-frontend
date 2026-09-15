import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Conversation } from '../../api/types';

export function ChannelInviteAcceptPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function accept() {
      setBusy(true);
      setError('');
      try {
        const response = await api<Conversation>(
          `/chat/channel-invites/${encodeURIComponent(token)}/accept`,
          { method: 'POST', body: JSON.stringify({}) },
        );
        if (cancelled) return;
        navigate(`/chat/${response.data.id}`, { replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not accept channel invite');
        setBusy(false);
      }
    }
    if (token) void accept();
    else {
      setError('Invite token is missing');
      setBusy(false);
    }
    return () => {
      cancelled = true;
    };
  }, [navigate, token]);

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <h1>Channel invite</h1>
        {busy ? <p className="muted">Joining channel…</p> : null}
        {error ? (
          <>
            <p className="error">{error}</p>
            <p>
              <Link to="/chat">Back to chat</Link>
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
