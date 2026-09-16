import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useOrganization } from '../../organizations/OrganizationContext';
import type { ChannelInvitePreview, Conversation } from '../../api/types';

export function ChannelInviteAcceptPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { organizations, activeOrganizationId, switchOrganization } =
    useOrganization();
  const [preview, setPreview] = useState<ChannelInvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await api<ChannelInvitePreview>(
          `/chat/channel-invites/${encodeURIComponent(token)}`,
        );
        if (cancelled) return;
        setPreview(response.data);
        if (!response.data.valid) {
          setError(response.data.message || 'This invite is no longer valid');
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Could not load channel invite',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (token) void load();
    else {
      setError('Invite token is missing');
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function joinChannel() {
    if (!session) {
      navigate('/login', {
        replace: false,
        state: { from: `/channel-invite/${token}` },
      });
      return;
    }

    const inviteOrgId = preview?.organizationId;
    if (inviteOrgId) {
      const belongs = organizations.some((org) => org.id === inviteOrgId);
      if (!belongs) {
        setError(
          'You are not in this workspace yet. Accept the workspace invite email first, then open this channel link again.',
        );
        return;
      }
      if (activeOrganizationId !== inviteOrgId) {
        switchOrganization(inviteOrgId);
      }
    }

    setBusy(true);
    setError('');
    try {
      const response = await api<Conversation>(
        `/chat/channel-invites/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify({}),
          headers: inviteOrgId
            ? { 'X-Organization-Id': inviteOrgId }
            : undefined,
        },
      );
      navigate(`/chat/${response.data.id}`, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not join channel. Make sure you belong to this workspace first.',
      );
      setBusy(false);
    }
  }

  const channelLabel = preview?.conversationName
    ? `#${preview.conversationName}`
    : 'this channel';

  return (
    <main className="auth-page">
      <div className="auth-panel channel-invite-panel">
        <p className="eyebrow">Channel invite</p>
        <h1>Join {channelLabel}</h1>
        {loading ? <p className="muted">Checking invite…</p> : null}
        {!loading && preview?.valid ? (
          <>
            <p className="muted">
              You&apos;ve been invited to join {channelLabel} on Relay.
              {preview.expiresAt
                ? ` This link expires ${new Date(preview.expiresAt).toLocaleString()}.`
                : ''}
            </p>
            {!session ? (
              <p className="muted">
                Sign in (or create an account) to join. If you are new to this
                workspace, accept the workspace invite email first.
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                className="btn full"
                type="button"
                disabled={busy}
                onClick={() => void joinChannel()}
              >
                {busy
                  ? 'Joining…'
                  : session
                    ? `Join ${channelLabel}`
                    : 'Sign in to join'}
              </button>
            </div>
          </>
        ) : null}
        {error ? (
          <>
            <p className="error">{error}</p>
            <p>
              <Link to={session ? '/chat' : '/login'}>
                {session ? 'Back to chat' : 'Go to login'}
              </Link>
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
