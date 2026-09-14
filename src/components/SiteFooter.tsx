import { Link } from 'react-router-dom';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="landing-wrap footer-grid">
        <div className="footer-brand">
          <Link className="logo" to="/">
            <span className="mark" />
            Relay
          </Link>
          <p>
            A private messenger for teams — chats, groups, and presence without
            the extra noise.
          </p>
        </div>
        <div>
          <h3>Product</h3>
          <Link to={{ pathname: '/', hash: 'product' }}>Features</Link>
          <Link to={{ pathname: '/', hash: 'how' }}>How it works</Link>
          <Link to={{ pathname: '/', hash: 'teams' }}>Who it is for</Link>
          <Link to={{ pathname: '/', hash: 'faq' }}>FAQ</Link>
        </div>
        <div>
          <h3>Workspace</h3>
          <Link to="/login">Sign in</Link>
          <Link to="/register">Create account</Link>
          <Link to="/chat">Messages</Link>
          <Link to="/profile">Profile</Link>
          <Link to="/blocked">Blocked users</Link>
        </div>
        <div>
          <h3>Company</h3>
          <a href="/Relay-Product-Idea.pdf" target="_blank" rel="noreferrer">
            Product brief (PDF)
          </a>
          <Link to="/register">Get started</Link>
          <Link to="/login">Sign in</Link>
        </div>
      </div>
      <div className="landing-wrap footer-bar">
        <span>© {new Date().getFullYear()} Relay</span>
        <span>Private team conversations</span>
      </div>
    </footer>
  );
}
