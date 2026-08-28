import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { initials } from '../lib/format';
import {
  getNotificationPermission,
  requestPermission,
} from '../lib/notifications';
import { resetDemoTour } from '../components/DemoTour';
import type { UserProfile, WorkspaceSettings } from '../api/types';

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
  }, [isAdmin]);

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
    const permission = await requestPermission();
    setNotifyStatus(permission);
    if (permission === 'granted') {
      setNotifyHint('Desktop notifications are on.');
    } else if (permission === 'denied') {
      setNotifyHint(
        'Notifications are blocked in your browser. Open site settings for this page and allow notifications.',
      );
    } else if (permission === 'unsupported') {
      setNotifyHint('This browser does not support desktop notifications.');
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
        <h1 className="profile-name">{name || 'Your profile'}</h1>
        <p className="profile-email">{session?.user.email}</p>
        <span className="role-chip">{isAdmin ? 'Admin' : 'Member'}</span>
        {profile?.bio ? <p className="profile-bio-preview">{profile.bio}</p> : null}
      </section>

      {error ? <p className="error profile-flash">{error}</p> : null}
      {saved ? <p className="ok profile-flash">{saved}</p> : null}

      <form
        className="profile-sheet"
        key={profile?.id ?? 'profile'}
        onSubmit={(event) => void saveProfile(event)}
      >
        <header className="profile-sheet-head">
          <h2>About</h2>
          <p className="muted">How you appear to people in Relay.</p>
        </header>

        <div className="profile-fields">
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
          <label className="profile-field profile-field-tall">
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
          <label className="profile-field">
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
          <label className="profile-field profile-check">
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

        <div className="profile-sheet-actions">
          <button className="btn" type="submit" disabled={busy}>
            Save profile
          </button>
        </div>
      </form>

      <section className="profile-sheet">
        <header className="profile-sheet-head">
          <h2>Notifications</h2>
          <p className="muted">
            Desktop alerts for new messages when Relay is in the background. Muted chats stay quiet.
          </p>
        </header>
        <div className="profile-notify">
          <p className="profile-notify-status">
            Status:{' '}
            <strong>
              {notifyStatus === 'granted'
                ? 'Allowed'
                : notifyStatus === 'denied'
                  ? 'Blocked by browser'
                  : notifyStatus === 'unsupported'
                    ? 'Not supported'
                    : 'Not enabled yet'}
            </strong>
          </p>
          {notifyHint ? <p className="muted">{notifyHint}</p> : null}
          {notifyStatus === 'granted' ? (
            <p className="muted">
              To turn them off, use your browser site settings for this page.
            </p>
          ) : notifyStatus === 'denied' ? (
            <p className="muted">
              Relay cannot ask again after a browser block. Allow notifications in the address-bar site
              settings, then refresh.
            </p>
          ) : notifyStatus === 'default' ? (
            <button className="btn" type="button" onClick={() => void enableDesktopNotifications()}>
              Enable desktop notifications
            </button>
          ) : null}
        </div>
      </section>

      {isAdmin && branding ? (
        <form className="profile-sheet" onSubmit={(event) => void saveBranding(event)}>
          <header className="profile-sheet-head">
            <h2>Workspace branding</h2>
            <p className="muted">White-label Relay for client demos — name, tagline, and accent color.</p>
          </header>
          <div className="profile-fields">
            <label>
              App name
              <input
                value={branding.appName}
                onChange={(event) =>
                  setBranding({ ...branding, appName: event.target.value })
                }
                maxLength={80}
              />
            </label>
            <label>
              Tagline
              <input
                value={branding.tagline}
                onChange={(event) =>
                  setBranding({ ...branding, tagline: event.target.value })
                }
                maxLength={200}
              />
            </label>
            <label>
              Primary color
              <input
                type="color"
                value={branding.primaryColor}
                onChange={(event) =>
                  setBranding({ ...branding, primaryColor: event.target.value })
                }
              />
            </label>
          </div>
          {brandingSaved ? <p className="success">{brandingSaved}</p> : null}
          <div className="profile-sheet-actions">
            <button className="btn" type="submit">
              Save branding
            </button>
          </div>
        </form>
      ) : null}

      <section className="profile-sheet">
        <header className="profile-sheet-head">
          <h2>Product tour</h2>
          <p className="muted">Replay the guided walkthrough shown on first sign-in.</p>
        </header>
        <div className="profile-sheet-body">
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
        </div>
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
