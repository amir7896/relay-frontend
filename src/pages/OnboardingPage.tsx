import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useOrganization } from '../organizations/OrganizationContext';
import { useWorkspace } from '../theme/WorkspaceContext';

export function OnboardingPage() {
  const { session, logout } = useAuth();
  const { organizations, createOrganization } = useOrganization();
  const workspace = useWorkspace();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (organizations.length > 0) {
    return <Navigate to="/chat" replace />;
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Workspace name must be at least 2 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createOrganization(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create workspace');
      setBusy(false);
    }
  }

  return (
    <main className="onboarding-page">
      <div className="onboarding-panel">
        <div className="onboarding-brand">
          <span className="mark" />
          <strong>{workspace.appName}</strong>
        </div>
        <p className="eyebrow">Welcome</p>
        <h1>Create a workspace</h1>
        <p className="muted onboarding-lead">
          A workspace is your team&apos;s home — with channels for topics and
          direct messages for 1:1 chats. You can invite people after you create
          it.
        </p>
        <form className="onboarding-form" onSubmit={(event) => void onCreate(event)}>
          <label>
            Workspace name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Corp"
              autoFocus
              required
              minLength={2}
              maxLength={120}
              disabled={busy}
            />
          </label>
          {error ? <p className="field-error">{error}</p> : null}
          <button className="btn full" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
        <p className="muted onboarding-invite">
          Have an invite link? Open it in this browser, or ask a teammate to
          invite you from their workspace.
        </p>
        <div className="onboarding-footer">
          <span className="muted">{session.user.email}</span>
          <button className="ghost" type="button" onClick={() => void logout()}>
            Sign out
          </button>
          <Link className="ghost" to="/">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
