import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { UserProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useOrganization } from '../organizations/OrganizationContext';
import { initials } from '../lib/format';
import { resolveMediaUrl } from './VoiceNotePlayer';
import { DirectoryProvider } from '../people/DirectoryContext';
import { ChatSocketProvider } from '../chat/ChatSocketContext';
import { VoiceCallProvider } from '../calls/VoiceCallContext';
import { DemoTour } from './DemoTour';
import { ThemeToggle } from './ThemeToggle';
import { VoiceCallOverlay } from './VoiceCallOverlay';
import { CommandPalette } from './CommandPalette';
import { useWorkspace } from '../theme/WorkspaceContext';

type NavItem = {
  to: string;
  label: string;
  adminOnly?: boolean;
  icon: ReactNode;
};

const RAIL_NAV: NavItem[] = [
  {
    to: '/chat',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
        />
      </svg>
    ),
  },
  {
    to: '/profile',
    label: 'Profile',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z"
        />
      </svg>
    ),
  },
  {
    to: '/blocked',
    label: 'Blocked',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 2a8 8 0 0 1 6.3 12.9L7.1 5.7A7.9 7.9 0 0 1 12 4zM5.7 7.1 18.3 19.7A8 8 0 0 1 5.7 7.1z"
        />
      </svg>
    ),
  },
  {
    to: '/people',
    label: 'People',
    adminOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M9 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 9 11zm6 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM9 13c-3.3 0-6 1.7-6 3.8V19h12v-2.2C15 14.7 12.3 13 9 13zm6.2 0c.3 0 .6 0 .8.1 2.2.5 3.9 1.8 3.9 3.5V19h-4.2v-2.1c0-.8-.3-1.5-.7-2.2.1 0 .1-.1.2-.1z"
        />
      </svg>
    ),
  },
  {
    to: '/analytics',
    label: 'Analytics',
    adminOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 19h16v2H4zm2-2V9h2v8zm5 0V5h2v12zm5 0v-6h2v6z"
        />
      </svg>
    ),
  },
];

function workspaceInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || 'WS';
}

export function AppShell() {
  const { session, logout } = useAuth();
  const {
    organizations,
    activeOrganizationId,
    switchOrganization,
    createOrganization,
  } = useOrganization();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState('');
  const [debugVerifyUrl, setDebugVerifyUrl] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [orgError, setOrgError] = useState('');
  const [orgBusy, setOrgBusy] = useState(false);
  const isAdmin = session?.user.role === 'admin';
  const workspace = useWorkspace();
  const email = session?.user.email ?? '';
  const handle = email.split('@')[0] || 'You';
  const activeOrg =
    organizations.find((org) => org.id === activeOrganizationId) ??
    organizations[0];

  const visibleNav = RAIL_NAV.filter((item) => !item.adminOnly || isAdmin);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', menuOpen);
    return () => document.body.classList.remove('nav-open');
  }, [menuOpen]);

  useEffect(() => {
    if (!session?.user.id || !activeOrganizationId) {
      setAvatarUrl(null);
      return;
    }
    let cancelled = false;
    void api<UserProfile>('/users/me')
      .then((response) => {
        if (cancelled) return;
        const url = response.data.avatar?.trim();
        setAvatarUrl(url ? resolveMediaUrl(url) : null);
      })
      .catch(() => {
        if (!cancelled) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, activeOrganizationId, location.pathname]);

  async function onLogout() {
    await logout();
    navigate('/');
  }

  function openOrgModal() {
    setNewOrgName('');
    setOrgError('');
    setOrgModalOpen(true);
  }

  function closeOrgModal() {
    if (orgBusy) return;
    setOrgModalOpen(false);
    setOrgError('');
  }

  async function onCreateOrganization(event: FormEvent) {
    event.preventDefault();
    const name = newOrgName.trim();
    if (name.length < 2) {
      setOrgError('Name must be at least 2 characters.');
      return;
    }
    setOrgBusy(true);
    setOrgError('');
    try {
      await createOrganization(name);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : 'Could not create workspace');
      setOrgBusy(false);
    }
  }

  async function resendVerification() {
    setVerifyBusy(true);
    setVerifyMessage('');
    try {
      const response = await api<{ sent: boolean; debugVerifyUrl?: string }>(
        '/auth/resend-verification',
        { method: 'POST', body: JSON.stringify({}) },
      );
      setVerifyMessage('Verification email sent.');
      setDebugVerifyUrl(response.data.debugVerifyUrl ?? '');
    } catch (err) {
      setVerifyMessage(err instanceof Error ? err.message : 'Could not resend verification');
    } finally {
      setVerifyBusy(false);
    }
  }

  return (
    <div className={`app slack-app${menuOpen ? ' side-nav-open' : ''}`}>
      <aside className="ws-rail" aria-label="Workspaces">
        <div className="ws-rail-orgs">
          {organizations.map((org) => {
            const active = org.id === activeOrganizationId;
            return (
              <button
                key={org.id}
                type="button"
                className={`ws-rail-org${active ? ' active' : ''}`}
                title={org.name}
                aria-label={org.name}
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  if (!active) switchOrganization(org.id);
                  else navigate('/chat');
                  setMenuOpen(false);
                }}
              >
                <span>{workspaceInitials(org.name)}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="ws-rail-org ws-rail-add"
            title="Create a workspace"
            aria-label="Create a workspace"
            onClick={openOrgModal}
          >
            <span>+</span>
          </button>
        </div>

        <nav className="ws-rail-nav" aria-label="App">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              aria-label={item.label}
              className={({ isActive }) =>
                `ws-rail-link${isActive ? ' active' : ''}`
              }
              onClick={() => setMenuOpen(false)}
            >
              {item.icon}
            </NavLink>
          ))}
        </nav>

        <div className="ws-rail-footer">
          <ThemeToggle />
          <button
            type="button"
            className="ws-rail-avatar"
            title={`${handle} · Sign out`}
            aria-label="Sign out"
            onClick={() => void onLogout()}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" />
            ) : (
              <span>{initials(handle)}</span>
            )}
          </button>
        </div>
      </aside>

      {menuOpen ? (
        <button
          className="side-nav-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="app-main">
        <header className="app-mobile-bar">
          <button
            className="ghost icon-btn menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? '×' : '☰'}
          </button>
          <NavLink className="logo mobile-bar-logo" to="/chat">
            <span className="mark" />
            {activeOrg?.name ?? workspace.appName}
          </NavLink>
          <ThemeToggle />
        </header>

        {session && session.user.isEmailVerified === false ? (
          <div className="verify-banner">
            <span>Verify your email to keep your Relay account secure.</span>
            <button
              className="ghost"
              type="button"
              disabled={verifyBusy}
              onClick={() => void resendVerification()}
            >
              {verifyBusy ? 'Sending…' : 'Resend'}
            </button>
            {verifyMessage ? <small>{verifyMessage}</small> : null}
            {debugVerifyUrl ? (
              <a href={debugVerifyUrl}>Open local verification link</a>
            ) : null}
          </div>
        ) : null}

        <DirectoryProvider>
          <ChatSocketProvider>
            <VoiceCallProvider>
              <Outlet />
              <VoiceCallOverlay />
              <CommandPalette />
              <DemoTour />
            </VoiceCallProvider>
          </ChatSocketProvider>
        </DirectoryProvider>
      </div>

      {orgModalOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="modal-backdrop"
              onClick={closeOrgModal}
              role="presentation"
            >
              <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="new-org-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-head">
                  <h2 id="new-org-title">Create a workspace</h2>
                  <button
                    className="ghost icon-btn"
                    type="button"
                    aria-label="Close"
                    disabled={orgBusy}
                    onClick={closeOrgModal}
                  >
                    ×
                  </button>
                </div>
                <form
                  className="modal-body modal-form"
                  onSubmit={(e) => void onCreateOrganization(e)}
                >
                  <p className="modal-lead">
                    Workspaces keep teams separate. Each one starts with a{' '}
                    <strong>#general</strong> channel.
                  </p>
                  <label>
                    Workspace name
                    <input
                      value={newOrgName}
                      onChange={(event) => setNewOrgName(event.target.value)}
                      placeholder="Acme Corp"
                      autoFocus
                      required
                      minLength={2}
                      maxLength={120}
                      disabled={orgBusy}
                    />
                  </label>
                  {orgError ? <p className="field-error">{orgError}</p> : null}
                  <div className="modal-actions">
                    <button
                      className="ghost"
                      type="button"
                      disabled={orgBusy}
                      onClick={closeOrgModal}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={orgBusy}>
                      {orgBusy ? 'Creating…' : 'Create workspace'}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
