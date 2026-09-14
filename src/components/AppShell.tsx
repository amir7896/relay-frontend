import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { UserProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { initials } from '../lib/format';
import { resolveMediaUrl } from './VoiceNotePlayer';
import { DirectoryProvider } from '../people/DirectoryContext';
import { ChatSocketProvider } from '../chat/ChatSocketContext';
import { VoiceCallProvider } from '../calls/VoiceCallContext';
import { DemoTour } from './DemoTour';
import { ThemeToggle } from './ThemeToggle';
import { VoiceCallOverlay } from './VoiceCallOverlay';
import { useWorkspace } from '../theme/WorkspaceContext';

type NavItem = {
  to: string;
  label: string;
  adminOnly?: boolean;
  icon: ReactNode;
};

const NAV_ITEMS: NavItem[] = [
  {
    to: '/chat',
    label: 'Messages',
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

export function AppShell() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState('');
  const [debugVerifyUrl, setDebugVerifyUrl] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const isAdmin = session?.user.role === 'admin';
  const workspace = useWorkspace();
  const email = session?.user.email ?? '';
  const handle = email.split('@')[0] || 'You';

  const visibleNav = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', menuOpen);
    return () => document.body.classList.remove('nav-open');
  }, [menuOpen]);

  useEffect(() => {
    if (!session?.user.id) {
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
  }, [session?.user.id, location.pathname]);

  async function onLogout() {
    await logout();
    navigate('/');
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
    <div className={`app${menuOpen ? ' side-nav-open' : ''}`}>
      <aside className="side-nav" id="app-side-nav" aria-label="Workspace">
        <NavLink className="side-nav-brand" to="/chat" onClick={() => setMenuOpen(false)}>
          <span className="mark" />
          <span className="side-nav-brand-text">
            <strong>{workspace.appName}</strong>
            <small>Workspace</small>
          </span>
        </NavLink>

        <nav className="side-nav-links" aria-label="Main">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `side-nav-link${isActive ? ' active' : ''}`
              }
              onClick={() => setMenuOpen(false)}
            >
              <span className="side-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="side-nav-footer">
          <div className="side-nav-user" title={email}>
            {avatarUrl ? (
              <img className="avatar sm" src={avatarUrl} alt="" />
            ) : (
              <div className="avatar sm">{initials(handle)}</div>
            )}
            <div className="side-nav-user-meta">
              <strong>{handle}</strong>
              <span className="role-chip">{isAdmin ? 'Admin' : 'Member'}</span>
            </div>
          </div>
          <div className="side-nav-tools">
            <ThemeToggle />
            <button className="ghost side-nav-signout" type="button" onClick={() => void onLogout()}>
              Sign out
            </button>
          </div>
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
            aria-controls="app-side-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? '×' : '☰'}
          </button>
          <NavLink className="logo mobile-bar-logo" to="/chat">
            <span className="mark" />
            {workspace.appName}
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
              <DemoTour />
            </VoiceCallProvider>
          </ChatSocketProvider>
        </DirectoryProvider>
      </div>
    </div>
  );
}
