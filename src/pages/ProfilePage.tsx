import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { initials } from '../lib/format';
import {
  getNotificationPermission,
  subscribeWebPush,
} from '../lib/notifications';
import { resetDemoTour } from '../components/DemoTour';
import type { UserProfile, WorkspaceSettings } from '../api/types';

type WorkspaceInvite = {
  id: string;
  email: string | null;
  inviteUrl: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export function ProfilePage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState(() => getNotificationPermission());
  const [notifyHint, setNotifyHint] = useState('');
  const isAdmin = session?.user.role === 'admin';
  const [branding, setBranding] = useState<WorkspaceSettings | null>(null);
  const [brandingSaved, setBrandingSaved] = useState('');
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    void api<UserProfile>('/users/me')
      .then((response) => setProfile(response.data))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not load profile');
      });
  }, []);

  useEffect(() => {
    setNotifyStatus(getNotificationPermission());
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    void api<WorkspaceSettings>('/workspace/settings')
      .then((response) => setBranding(response.data))
      .catch(() => undefined);
    void loadInvites();
  }, [isAdmin]);

  async function loadInvites() {
    try {
      const response = await api<WorkspaceInvite[]>('/auth/invites');
      setInvites(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invites');
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    try {
      const response = await api<WorkspaceInvite>('/auth/invites', {
        method: 'POST',
        body: JSON.stringify({
          email: email || undefined,
          expiresInDays: Number(form.get('expiresInDays') ?? 7),
          maxUses: email ? 1 : Number(form.get('maxUses') ?? 25),
        }),
      });
      setInviteUrl(response.data.inviteUrl);
      event.currentTarget.reset();
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    try {
      await api(`/auth/invites/${id}`, { method: 'DELETE' });
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke invite');
    }
  }

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branding) {
      return;
    }
    setBrandingSaved('');
    try {
      const response = await api<WorkspaceSettings>('/workspace/settings', {
        method: 'PATCH',
        body: JSON.stringify(branding),
      });
      setBranding(response.data);
      document.documentElement.style.setProperty('--brand', response.data.primaryColor);
      setBrandingSaved('Workspace branding saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save branding');
    }
  }

  async function enableDesktopNotifications() {
    setNotifyHint('');
    try {
      const permission = await subscribeWebPush();
      setNotifyStatus(permission === 'disabled' ? 'granted' : permission);
      if (permission === 'granted') {
        setNotifyHint('Desktop and push notifications are on.');
      } else if (permission === 'disabled') {
        setNotifyHint('Desktop notifications are on, but server push is not configured.');
      } else if (permission === 'denied') {
        setNotifyHint(
          'Notifications are blocked in your browser. Open site settings for this page and allow notifications.',
        );
      } else if (permission === 'unsupported') {
        setNotifyHint('This browser does not support push notifications.');
      }
    } catch (err) {
      setNotifyHint(err instanceof Error ? err.message : 'Could not enable push notifications.');
      setNotifyStatus(getNotificationPermission());
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaved('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | boolean> = {};
    for (const key of ['firstName', 'lastName', 'phone', 'bio', 'avatar', 'dateOfBirth']) {
      const value = String(form.get(key) ?? '').trim();
      if (value) {
        body[key] = value;
      }
    }
    body.showLastSeen = form.get('showLastSeen') === 'on';
    try {
      const response = await api<UserProfile>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setProfile(response.data);
      setSaved('Profile saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword: form.get('currentPassword'),
          newPassword: form.get('newPassword'),
        }),
      });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password');
      setBusy(false);
    }
  }

  const name = profile
    ? `${profile.firstName} ${profile.lastName}`.trim()
    : session?.user.email ?? 'You';
  const avatarUrl = profile?.avatar?.trim() || '';
  const notifyLabel =
    notifyStatus === 'granted'
      ? 'Allowed'
      : notifyStatus === 'denied'
        ? 'Blocked'
        : notifyStatus === 'unsupported'
          ? 'Unsupported'
          : 'Off';

  return (
    <main className="page profile-page">
      <section className="profile-hero-card">
        <div className="profile-avatar-wrap">
          {avatarUrl ? (
            <img className="profile-avatar-img" src={avatarUrl} alt="" />
          ) : (
            <div className="avatar xl profile-avatar-fallback">{initials(name)}</div>
          )}
        </div>
        <div className="profile-hero-copy">
          <p className="eyebrow">Your account</p>
          <h1 className="profile-name">{name || 'Your profile'}</h1>
          <p className="profile-email">{session?.user.email}</p>
          <div className="profile-hero-meta">
            <span className="role-chip">{isAdmin ? 'Admin' : 'Member'}</span>
            {profile?.showLastSeen === false ? (
              <span className="profile-meta-chip">Last seen hidden</span>
            ) : null}
          </div>
          {profile?.bio ? <p className="profile-bio-preview">{profile.bio}</p> : null}
        </div>
      </section>

      {error ? <p className="error profile-flash">{error}</p> : null}
      {saved ? <p className="ok profile-flash">{saved}</p> : null}

      <form
        className="profile-sheet"
        key={profile?.id ?? 'profile'}
        onSubmit={(event) => void saveProfile(event)}
      >
        <header className="profile-sheet-head profile-sheet-head-row">
          <div>
            <h2>About</h2>
            <p className="muted">How you appear to people in Relay.</p>
          </div>
          <button className="btn profile-save-inline" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </header>

        <div className="profile-fields profile-fields-grid">
          <label className="profile-field">
            <span className="profile-field-icon" aria-hidden="true">
              <PersonIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">First name</span>
              <input name="firstName" defaultValue={profile?.firstName ?? ''} autoComplete="given-name" />
            </span>
          </label>
          <label className="profile-field">
            <span className="profile-field-icon" aria-hidden="true">
              <PersonIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Last name</span>
              <input name="lastName" defaultValue={profile?.lastName ?? ''} autoComplete="family-name" />
            </span>
          </label>
          <label className="profile-field">
            <span className="profile-field-icon" aria-hidden="true">
              <PhoneIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Phone</span>
              <input
                name="phone"
                defaultValue={profile?.phone ?? ''}
                autoComplete="tel"
                placeholder="Optional"
              />
            </span>
          </label>
          <label className="profile-field">
            <span className="profile-field-icon" aria-hidden="true">
              <CakeIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Birthday</span>
              <input
                name="dateOfBirth"
                placeholder="YYYY-MM-DD"
                defaultValue={profile?.dateOfBirth ?? ''}
              />
            </span>
          </label>
          <label className="profile-field profile-field-tall profile-field-span">
            <span className="profile-field-icon" aria-hidden="true">
              <InfoIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Bio</span>
              <textarea
                name="bio"
                rows={3}
                defaultValue={profile?.bio ?? ''}
                placeholder="A short line about you"
              />
            </span>
          </label>
          <label className="profile-field profile-field-span">
            <span className="profile-field-icon" aria-hidden="true">
              <ImageIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Avatar URL</span>
              <input
                name="avatar"
                defaultValue={profile?.avatar ?? ''}
                placeholder="https://…"
                autoComplete="off"
              />
            </span>
          </label>
          <label className="profile-field profile-check profile-field-span">
            <span className="profile-field-icon" aria-hidden="true">
              <EyeIcon />
            </span>
            <span className="profile-field-body">
              <span className="profile-field-label">Show last seen</span>
              <span className="profile-check-row">
                <input
                  type="checkbox"
                  name="showLastSeen"
                  defaultChecked={profile?.showLastSeen !== false}
                />
                <span className="muted">Let others see when you were last online</span>
              </span>
            </span>
          </label>
        </div>

        <div className="profile-sheet-actions profile-sheet-actions-mobile">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <section className="profile-sheet">
        <header className="profile-sheet-head">
          <h2>Notifications</h2>
          <p className="muted">
            Alerts for new messages when Relay is in the background. Muted chats stay quiet.
          </p>
        </header>
        <div className="profile-notify">
          <div className="profile-notify-row">
            <p className="profile-notify-status">
              Status{' '}
              <span className={`notify-pill notify-pill-${notifyStatus}`}>{notifyLabel}</span>
            </p>
            {notifyStatus === 'default' ? (
              <button className="btn" type="button" onClick={() => void enableDesktopNotifications()}>
                Enable notifications
              </button>
            ) : null}
          </div>
          {notifyHint ? <p className="muted">{notifyHint}</p> : null}
          {notifyStatus === 'granted' ? (
            <p className="muted">
              To turn them off, use your browser site settings for this page.
            </p>
          ) : null}
          {notifyStatus === 'denied' ? (
            <p className="muted">
              Relay cannot ask again after a browser block. Allow notifications in the address-bar
              site settings, then refresh.
            </p>
          ) : null}
        </div>
      </section>

      {isAdmin && branding ? (
        <form className="profile-sheet" onSubmit={(event) => void saveBranding(event)}>
          <header className="profile-sheet-head profile-sheet-head-row">
            <div>
              <p className="eyebrow">Admin</p>
              <h2>Workspace branding</h2>
              <p className="muted">White-label Relay for client demos — name, tagline, and accent.</p>
            </div>
            <button className="btn profile-save-inline" type="submit">
              Save branding
            </button>
          </header>
          <div className="profile-fields profile-fields-grid profile-branding-fields">
            <label className="profile-plain-field">
              App name
              <input
                value={branding.appName}
                onChange={(event) =>
                  setBranding({ ...branding, appName: event.target.value })
                }
                maxLength={80}
              />
            </label>
            <label className="profile-plain-field">
              Tagline
              <input
                value={branding.tagline}
                onChange={(event) =>
                  setBranding({ ...branding, tagline: event.target.value })
                }
                maxLength={200}
              />
            </label>
            <label className="profile-plain-field profile-color-field">
              Primary color
              <span className="profile-color-row">
                <input
                  type="color"
                  value={branding.primaryColor}
                  onChange={(event) =>
                    setBranding({ ...branding, primaryColor: event.target.value })
                  }
                />
                <code>{branding.primaryColor}</code>
              </span>
            </label>
          </div>
          {brandingSaved ? <p className="ok profile-inline-ok">{brandingSaved}</p> : null}
          <div className="profile-sheet-actions profile-sheet-actions-mobile">
            <button className="btn" type="submit">
              Save branding
            </button>
          </div>
        </form>
      ) : null}

      {isAdmin ? (
        <section className="profile-sheet">
          <header className="profile-sheet-head">
            <p className="eyebrow">Admin</p>
            <h2>Workspace invites</h2>
            <p className="muted">Create an open invite or bind one to a specific email.</p>
          </header>
          <form className="invite-form" onSubmit={(event) => void createInvite(event)}>
            <label>
              Email (optional)
              <input name="email" type="email" placeholder="person@example.com" />
            </label>
            <label>
              Expires in days
              <input name="expiresInDays" type="number" min="1" max="90" defaultValue="7" required />
            </label>
            <label>
              Maximum uses
              <input name="maxUses" type="number" min="1" max="500" defaultValue="25" required />
            </label>
            <button className="btn" type="submit" disabled={inviteBusy}>
              {inviteBusy ? 'Creating…' : 'Create invite'}
            </button>
          </form>
          {inviteUrl ? (
            <div className="invite-created">
              <a href={inviteUrl}>{inviteUrl}</a>
              <button
                className="btn ghost"
                type="button"
                onClick={() => void navigator.clipboard.writeText(inviteUrl)}
              >
                Copy
              </button>
            </div>
          ) : null}
          <div className="invite-list">
            {invites.length === 0 ? <p className="muted invite-empty">No invites created yet.</p> : null}
            {invites.map((invite) => {
              const expired = new Date(invite.expiresAt).getTime() <= Date.now();
              return (
                <div className="invite-row" key={invite.id}>
                  <div>
                    <strong>{invite.email ?? 'Open invitation'}</strong>
                    <small>
                      {invite.usedCount}/{invite.maxUses} used · expires{' '}
                      {new Date(invite.expiresAt).toLocaleDateString()}
                      {invite.revokedAt ? ' · revoked' : expired ? ' · expired' : ''}
                    </small>
                  </div>
                  {!invite.revokedAt && !expired ? (
                    <button
                      className="danger-text"
                      type="button"
                      onClick={() => void revokeInvite(invite.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="profile-sheet profile-sheet-compact">
        <header className="profile-sheet-head profile-sheet-head-row">
          <div>
            <h2>Product tour</h2>
            <p className="muted">Replay the guided walkthrough shown on first sign-in.</p>
          </div>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              resetDemoTour();
              navigate('/chat');
            }}
          >
            Restart demo tour
          </button>
        </header>
      </section>

      <form className="profile-sheet" onSubmit={(event) => void changePassword(event)}>
        <header className="profile-sheet-head">
          <h2>Security</h2>
          <p className="muted">Updating your password signs you out so you can sign in again.</p>
        </header>

        <div className="profile-fields profile-fields-password">
          <PasswordInput
            label="Current password"
            name="currentPassword"
            required
            autoComplete="current-password"
          />
          <PasswordInput
            label="New password"
            name="newPassword"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        <div className="profile-sheet-actions">
          <button className="btn" type="submit" disabled={busy}>
            Update password
          </button>
        </div>
      </form>
    </main>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19.2c1.6-3 4-4.5 6.5-4.5s4.9 1.5 6.5 4.5" strokeLinecap="round" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M8.2 4.8h2.4l1 3.2-1.5 1a12 12 0 0 0 4.9 4.9l1-1.5 3.2 1v2.4c0 .7-.5 1.3-1.2 1.4A15.5 15.5 0 0 1 4.4 6c.1-.7.7-1.2 1.4-1.2Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CakeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4v3M8 10h8v9H8zM7 19h10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 10V8.5a2 2 0 0 1 4 0V10" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5M12 8.2h.01" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M7 17l4-4 3 3 3-4 3 5" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
