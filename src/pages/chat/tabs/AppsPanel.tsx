import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { AppCatalogItem } from '../../../api/types';

export function AppsPanel() {
  const [apps, setApps] = useState<AppCatalogItem[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      api<AppCatalogItem[]>('/chat/apps'),
      api<AppCatalogItem[]>('/chat/apps/installed'),
    ])
      .then(([catalog, current]) => {
        if (!active) return;
        setApps(catalog.data ?? []);
        setInstalled(new Set((current.data ?? []).map((app) => app.key)));
      })
      .catch(() => {
        if (active) setError('The app catalog is not available yet.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function toggle(app: AppCatalogItem) {
    const isInstalled = installed.has(app.key);
    setBusyKey(app.key);
    setError('');
    try {
      await api(`/chat/apps/${encodeURIComponent(app.key)}${isInstalled ? '' : '/install'}`, {
        method: isInstalled ? 'DELETE' : 'POST',
      });
      setInstalled((current) => {
        const next = new Set(current);
        if (isInstalled) next.delete(app.key);
        else next.add(app.key);
        return next;
      });
    } catch {
      setError(`Could not ${isInstalled ? 'uninstall' : 'install'} ${app.name}.`);
    } finally {
      setBusyKey('');
    }
  }

  return (
    <section className="feature-panel apps-panel">
      <div className="feature-panel-head"><div><h3>Apps</h3><p className="muted">Add tools and integrations to your workspace.</p></div></div>
      {error ? <p className="muted tab-notice">{error}</p> : null}
      <div className="apps-grid">
        {apps.map((app) => (
          <article key={app.key} className="app-card">
            <span className="app-card-icon">{app.iconUrl ? <img src={app.iconUrl} alt="" /> : app.name.slice(0, 1).toUpperCase()}</span>
            <div><h4>{app.name}</h4><p className="muted">{app.description || 'Workspace integration'}</p></div>
            <button className={installed.has(app.key) ? 'ghost' : 'btn'} type="button" disabled={busyKey === app.key} onClick={() => void toggle(app)}>
              {busyKey === app.key ? 'Working…' : installed.has(app.key) ? 'Uninstall' : 'Install'}
            </button>
          </article>
        ))}
      </div>
      {!error && apps.length === 0 ? <p className="muted tab-empty">No apps in the catalog.</p> : null}
    </section>
  );
}
