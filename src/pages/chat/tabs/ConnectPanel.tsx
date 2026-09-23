import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type {
  ConnectActivityEvent,
  ConnectInvite,
  ConnectLink,
  ConnectStatus,
} from '../../../api/types';

function absoluteInviteUrl(pathOrUrl: string | null | undefined) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

function formatActivityAction(action: string, meta: Record<string, unknown>) {
  switch (action) {
    case 'connect.invite.created':
      return meta.inviteKind === 'workspace_share'
        ? `Workspace invite created for ${String(meta.email ?? 'partner')}`
        : `Guest invite created for ${String(meta.email ?? 'guest')}`;
    case 'connect.invite.revoked':
      return `Invite revoked (${String(meta.email ?? 'unknown')})`;
    case 'connect.invite.accepted':
      return `Guest accepted — role: ${String(meta.role ?? 'guest')}`;
    case 'connect.workspace.connected':
      return `Workspaces connected${
        meta.partnerOrganizationName
          ? ` with ${String(meta.partnerOrganizationName)}`
          : ''
      }`;
    case 'connect.channel.disconnected':
      return `Shared channel disconnected (${String(meta.disconnectedBy ?? 'party')})`;
    default:
      return action.replace(/^connect\./, '').replace(/\./g, ' ');
  }
}

function formatWhen(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ConnectPanel({ conversationId }: { conversationId: string }) {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'guest' | 'workspace'>('workspace');
  const [notice, setNotice] = useState('');
  const [lastInviteUrl, setLastInviteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

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
        const pending = data?.invites?.filter((invite) => invite.status === 'pending') ?? [];
        const newest = pending[0];
        if (newest) {
          const url = absoluteInviteUrl(
            newest.inviteUrl ||
              (newest.token ? `/connect-invite/${newest.token}` : ''),
          );
          if (url) setLastInviteUrl(url);
        }
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
      const created = await api<
        ConnectInvite & {
          inviteUrl?: string;
          token?: string;
          emailDelivered?: boolean;
        }
      >(`/chat/conversations/${conversationId}/connect/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), mode }),
      });
      await refresh();
      setEmail('');
      const url = absoluteInviteUrl(
        created.data.inviteUrl ||
          (created.data.token ? `/connect-invite/${created.data.token}` : ''),
      );
      setLastInviteUrl(url);
      const mailed = created.data.emailDelivered
        ? ' Email sent.'
        : ' Copy the link below if email was not delivered.';
      setNotice(
        url
          ? mode === 'workspace'
            ? `Workspace share invite ready.${mailed}`
            : `Guest invite ready.${mailed}`
          : 'Invitation created.',
      );
      if (url) {
        window.setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(
            '.connect-link-box input',
          );
          input?.focus();
          input?.select();
        }, 50);
      }
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
      setNotice('Invite link copied — paste it in Slack, email, or chat.');
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

  async function disconnectLink(linkId: string) {
    setDisconnectingId(linkId);
    setNotice('');
    try {
      await api(`/chat/conversations/${conversationId}/connect/links/${linkId}`, {
        method: 'DELETE',
      });
      await refresh();
      setNotice('Shared channel disconnected.');
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : 'Could not disconnect shared channel.',
      );
    } finally {
      setDisconnectingId(null);
    }
  }

  const connected = Boolean(status?.isShared);
  const isPartner = status?.connectRole === 'partner';
  const pendingInvites =
    status?.invites?.filter((invite) => invite.status === 'pending') ?? [];
  const acceptedGuests =
    status?.invites?.filter(
      (invite) =>
        invite.status === 'accepted' &&
        (invite.inviteKind ?? 'guest_email') === 'guest_email',
    ) ?? [];
  const links: ConnectLink[] = status?.links ?? [];
  const linkHistory: ConnectLink[] = status?.linkHistory ?? [];
  const activity: ConnectActivityEvent[] = status?.activity ?? [];

  return (
    <section className="feature-panel connect-panel">
      <div className="feature-panel-head">
        <div>
          <h3>Connect</h3>
          <p className="muted">
            {isPartner
              ? 'This channel is shared with another workspace. Messages sync to the host channel.'
              : 'Share this channel with another workspace, or invite an external guest.'}
          </p>
        </div>
        {status?.connectRole ? (
          <span className={`connect-role-badge connect-role-${status.connectRole}`}>
            {status.connectRole === 'host' ? 'Host workspace' : 'Partner workspace'}
          </span>
        ) : null}
      </div>
      <div className="connect-status">
        <span
          className={`connect-indicator${connected ? ' active' : ''}`}
          aria-hidden="true"
        />
        <div>
          <strong>
            {connected
              ? isPartner
                ? 'Connected (partner workspace)'
                : 'Connected channel'
              : 'Not connected yet'}
          </strong>
          <p className="muted">
            {status?.sharedExternalLabel
              ? `Shared with ${status.sharedExternalLabel}`
              : 'Create a workspace share or guest invite to collaborate across organizations.'}
          </p>
        </div>
      </div>

      {!isPartner ? (
        <form className="connect-invite" onSubmit={invite}>
          <fieldset className="connect-mode">
            <legend>Invite type</legend>
            <label className="connect-mode-option">
              <input
                type="radio"
                name="connectMode"
                checked={mode === 'workspace'}
                onChange={() => setMode('workspace')}
              />
              <span>
                <strong>Workspace share</strong>
                <span className="muted">
                  True multi-org channel — partner keeps their own workspace
                </span>
              </span>
            </label>
            <label className="connect-mode-option">
              <input
                type="radio"
                name="connectMode"
                checked={mode === 'guest'}
                onChange={() => setMode('guest')}
              />
              <span>
                <strong>Guest</strong>
                <span className="muted">
                  External person joins this workspace as a guest
                </span>
              </span>
            </label>
          </fieldset>
          <label>
            {mode === 'workspace' ? 'Partner contact email' : 'Invite by email'}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@partner.com"
              required
            />
          </label>
          <button className="btn" type="submit" disabled={busy || !email.trim()}>
            {busy
              ? 'Creating…'
              : mode === 'workspace'
                ? 'Create workspace share invite'
                : 'Create guest invite'}
          </button>
        </form>
      ) : null}

      {lastInviteUrl ? (
        <div className="connect-link-box">
          <label className="connect-link-label">
            Invite link
            <input
              type="text"
              readOnly
              value={lastInviteUrl}
              aria-label="Connect invite link"
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button
            className="btn"
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

      {links.length > 0 ? (
        <div className="connect-invite-list">
          <h4>Connected workspaces</h4>
          <ul>
            {links.map((link) => (
              <li key={link.id}>
                <div>
                  <strong>
                    {isPartner
                      ? link.hostOrganizationName || 'Host workspace'
                      : link.partnerOrganizationName || 'Partner workspace'}
                  </strong>
                  <span className="muted"> · {link.status}</span>
                </div>
                <button
                  type="button"
                  className="ghost danger-text"
                  disabled={disconnectingId === link.id}
                  onClick={() => void disconnectLink(link.id)}
                >
                  {disconnectingId === link.id ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </li>
            ))}
          </ul>
        </div>
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
              const kindLabel =
                invite.inviteKind === 'workspace_share' ? 'Workspace' : 'Guest';
              return (
                <li key={invite.id}>
                  <div>
                    <strong>{invite.email}</strong>
                    <span className="muted"> · {kindLabel}</span>
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

      {acceptedGuests.length > 0 ? (
        <div className="connect-invite-list">
          <h4>Guest access</h4>
          <ul>
            {acceptedGuests.map((invite) => (
              <li key={invite.id}>
                <div>
                  <strong>{invite.email}</strong>
                  <span className="connect-role-pill">Guest</span>
                  {invite.acceptedAt ? (
                    <span className="muted"> · joined {formatWhen(invite.acceptedAt)}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {linkHistory.length > 0 ? (
        <div className="connect-invite-list">
          <h4>Past connections</h4>
          <ul>
            {linkHistory.map((link) => (
              <li key={link.id}>
                <div>
                  <strong>
                    {link.partnerOrganizationName ||
                      link.hostOrganizationName ||
                      'Workspace'}
                  </strong>
                  <span className="muted"> · disconnected</span>
                  {link.disconnectedAt ? (
                    <span className="muted"> · {formatWhen(link.disconnectedAt)}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {activity.length > 0 ? (
        <div className="connect-activity">
          <h4>Audit trail</h4>
          <ol>
            {activity.map((event) => (
              <li key={event.id}>
                <time dateTime={event.createdAt}>{formatWhen(event.createdAt)}</time>
                <span>{formatActivityAction(event.action, event.meta)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
