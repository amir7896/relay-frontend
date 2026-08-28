import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SiteFooter } from './SiteFooter';
import { ThemeToggle } from './ThemeToggle';

export function GuestLayout() {
  const { session } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuthPage =
    location.pathname === '/login' || location.pathname === '/register';

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    document.body.classList.toggle('nav-open', menuOpen);
    return () => document.body.classList.remove('nav-open');
  }, [menuOpen]);

  if (session && isAuthPage) {
    return <Navigate to="/chat" replace />;
  }

  return (
    <div className={isAuthPage ? 'guest guest-auth' : 'guest'}>
      <header className="topbar">
        <Link className="logo" to="/">
          <span className="mark" />
          Relay
        </Link>
        {!isAuthPage ? (
          <nav className="topbar-links" aria-label="Product">
            <Link to={{ pathname: '/', hash: 'product' }}>Product</Link>
            <Link to={{ pathname: '/', hash: 'how' }}>How it works</Link>
            <Link to={{ pathname: '/', hash: 'teams' }}>For teams</Link>
            <Link to={{ pathname: '/', hash: 'faq' }}>FAQ</Link>
          </nav>
        ) : null}
        <nav className="topbar-actions">
          <ThemeToggle />
          {session ? (
            <Link className="btn topbar-cta" to="/chat">
              Open messages
            </Link>
          ) : isAuthPage ? (
            location.pathname === '/register' ? (
              <Link className="btn ghost topbar-signin" to="/login">
                Sign in
              </Link>
            ) : (
              <Link className="btn topbar-cta" to="/register">
                Create account
              </Link>
            )
          ) : (
            <>
              <Link className="btn ghost topbar-signin" to="/login">
                Sign in
              </Link>
              <Link className="btn topbar-cta" to="/register">
                Create account
              </Link>
            </>
          )}
          {!isAuthPage ? (
            <button
              className="ghost icon-btn menu-toggle"
              type="button"
              aria-expanded={menuOpen}
              aria-controls="guest-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? '×' : '☰'}
            </button>
          ) : null}
        </nav>
      </header>

      {menuOpen && !isAuthPage ? (
        <div className="mobile-menu" id="guest-menu">
          <nav className="mobile-menu-nav" aria-label="Mobile">
            <Link to={{ pathname: '/', hash: 'product' }}>Product</Link>
            <Link to={{ pathname: '/', hash: 'how' }}>How it works</Link>
            <Link to={{ pathname: '/', hash: 'teams' }}>For teams</Link>
            <Link to={{ pathname: '/', hash: 'faq' }}>FAQ</Link>
            <hr />
            {session ? (
              <Link className="btn full" to="/chat">
                Open messages
              </Link>
            ) : (
              <>
                <Link className="btn ghost full" to="/login">
                  Sign in
                </Link>
                <Link className="btn full" to="/register">
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      ) : null}

      <Outlet />
      {isAuthPage ? (
        <footer className="auth-footer">
          <Link to="/">← Back to Relay</Link>
        </footer>
      ) : (
        <SiteFooter />
      )}
    </div>
  );
}
