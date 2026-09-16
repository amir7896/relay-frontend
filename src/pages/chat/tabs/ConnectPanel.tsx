import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { ConnectInvite, ConnectStatus } from '../../../api/types';

function absoluteInviteUrl(pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

export function ConnectPanel({ conversationId }: { conversationId: string }) {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [lastInviteUrl, setLastInviteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function refresh() {
    const response = await api<ConnectStatus>(
      `/chat/conversations/${conversationId}/connect`,
    );
    setStatus(response.data);
    return response.data;
  }

  useEffect(() => {
    let active = true;
    setNotice('');
    setLastInviteUrl('');
    refresh()
      .then((data) => {
        if (!active) return;
        setStatus(data);
      })
      .catch(() => {
        if (active) setNotice('Connect is not available for this conversation yet.');
      });
    return () => {
      active = false;
    };
  }, [conversationId]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setNotice('');
    try {
      const created = await api<ConnectInvite & { inviteUrl?: string; token?: string }>(
        `/chat/conversations/${conversationId}/connect/invite`,
        {
          method: 'POST',
          body: JSON.stringify({ email: email.trim() }),
        },
      );
      await refresh();
      setEmail('');
      const url = absoluteInviteUrl(
        created.data.inviteUrl ||
          (created.data.token ? `/connect-invite/${created.data.token}` : ''),
      );
      setLastInviteUrl(url);
      setNotice(
        url
          ? 'Invitation created. Copy the link and send it to your collaborator.'
          : 'Invitation created.',
      );
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : 'Could not send the invitation.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Invite link copied.');
    } catch {
      setNotice('Could not copy the link. Select and copy it manually.');
    }
  }

  async function revokeInvite(inviteId: string) {
    setRevokingId(inviteId);
    setNotice('');
    try {
      await api(`/chat/conversations/${conversationId}/connect/invites/${inviteId}`, {
        method: 'DELETE',
      });
      await refresh();
      setNotice('Invite revoked.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not revoke invite.');
    } finally {
      setRevokingId(null);
    }
  }

  const connected = Boolean(status?.isShared);
  const pendingInvites =
    status?.invites?.filter((invite) => invite.status === 'pending') ?? [];
  const acceptedInvites =
    status?.invites?.filter((invite) => invite.status === 'accepted') ?? [];

  return (
    <section className="feature-panel connect-panel">
      <div className="feature-panel-head">
        <div>
          <h3>Connect</h3>
          <p className="muted">
            Invite people from another organization into this channel as guests.
          </p>
        </div>
      </div>
      <div className="connect-status">
        <span
          className={`connect-indicator${connected ? ' active' : ''}`}
          aria-hidden="true"
        />
        <div>
          <strong>{connected ? 'Connected channel' : 'Not connected yet'}</strong>
          <p className="muted">
            {status?.sharedExternalLabel
              ? `Shared with ${status.sharedExternalLabel}`
              : 'Send a Connect invite to start collaborating across organizations.'}
          </p>
        </div>
      </div>
      <form className="connect-invite" onSubmit={invite}>
        <label>
          Invite by email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@partner.com"
            required
          />
        </label>
        <button className="btn" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Creating…' : 'Create Connect invite'}
        </button>
      </form>
      {lastInviteUrl ? (
        <div className="connect-link-box">
          <input type="text" readOnly value={lastInviteUrl} aria-label="Connect invite link" />
          <button
            className="btn ghost"
            type="button"
            onClick={() => void copyLink(lastInviteUrl)}
          >
            Copy link
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="muted tab-notice" role="status">
          {notice}
        </p>
      ) : null}
      {pendingInvites.length > 0 ? (
        <div className="connect-invite-list">
          <h4>Pending invites</h4>
          <ul>
            {pendingInvites.map((invite) => {
              const url = absoluteInviteUrl(
                invite.inviteUrl ||
                  (invite.token ? `/connect-invite/${invite.token}` : ''),
              );
              return (
                <li key={invite.id}>
                  <div>
                    <strong>{invite.email}</strong>
                    {url ? (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => void copyLink(url)}
                      >
                        Copy link
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="ghost danger-text"
                    disabled={revokingId === invite.id}
                    onClick={() => void revokeInvite(invite.id)}
                  >
                    {revokingId === invite.id ? 'Revoking…' : 'Revoke'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {acceptedInvites.length > 0 ? (
        <p className="muted">
          Connected: {acceptedInvites.map((invite) => invite.email).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
