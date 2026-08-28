import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { initials } from '../lib/format';
import { DirectoryProvider } from '../people/DirectoryContext';
import { ChatSocketProvider } from '../chat/ChatSocketContext';
import { DemoTour } from './DemoTour';
import { ThemeToggle } from './ThemeToggle';
import { useWorkspace } from '../theme/WorkspaceContext';

export function AppShell() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = session?.user.role === 'admin';
  const workspace = useWorkspace();
  const email = session?.user.email ?? '';
  const handle = email.split('@')[0] || 'You';

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', menuOpen);
    return () => document.body.classList.remove('nav-open');
  }, [menuOpen]);

  async function onLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="app">
      <header className="appbar">
        <NavLink className="logo" to="/chat">
          <span className="mark" />
          {workspace.appName}
        </NavLink>
        <nav className="app-nav" aria-label="Main">
          <NavLink to="/chat">Messages</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          {isAdmin ? <NavLink to="/people">People</NavLink> : null}
          {isAdmin ? <NavLink to="/analytics">Analytics</NavLink> : null}
        </nav>
        <div className="appbar-user">
          <div className="appbar-identity" title={email}>
            <div className="avatar sm">{initials(handle)}</div>
            <div className="appbar-meta">
              <strong>{handle}</strong>
              <span className="role-chip">{isAdmin ? 'Admin' : 'Member'}</span>
            </div>
          </div>
          <ThemeToggle />
          <button className="ghost appbar-signout" type="button" onClick={() => void onLogout()}>
            Sign out
          </button>
          <button
            className="ghost icon-btn menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="app-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? '×' : '☰'}
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div className="mobile-menu" id="app-menu">
          <nav className="mobile-menu-nav" aria-label="Mobile">
            <NavLink to="/chat">Messages</NavLink>
            <NavLink to="/profile">Profile</NavLink>
            {isAdmin ? <NavLink to="/people">People</NavLink> : null}
            {isAdmin ? <NavLink to="/analytics">Analytics</NavLink> : null}
            <hr />
            <p className="muted mobile-menu-email">{email}</p>
            <button className="danger full" type="button" onClick={() => void onLogout()}>
              Sign out
            </button>
          </nav>
        </div>
      ) : null}

      <DirectoryProvider>
        <ChatSocketProvider>
          <Outlet />
          <DemoTour />
        </ChatSocketProvider>
      </DirectoryProvider>
    </div>
  );
}
