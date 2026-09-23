import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Incident } from '../../api/types';

type Props = {
  onOpenChannel: (conversationId: string) => void;
};

export function IncidentsView({ onOpenChannel }: Props) {
  const [items, setItems] = useState<Incident[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'active' | 'resolved' | 'all'>('active');

  const load = useCallback(async (nextScope: typeof scope) => {
    setBusy(true);
    setError('');
    try {
      const response = await api<Incident[]>(
        `/chat/incidents?scope=${encodeURIComponent(nextScope)}`,
      );
      setItems(response.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load incidents');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  return (
    <div className="incidents-panel">
      <header className="incidents-panel-head">
        <div>
          <h3>Incidents</h3>
          <p className="muted">
            Ops war-rooms across the workspace. Open one in a channel with{' '}
            <code>/incident open sev2 title</code>.
          </p>
        </div>
      </header>

      <div className="incidents-tabs" role="tablist" aria-label="Incident scope">
        {(
          [
            ['active', 'Active'],
            ['resolved', 'Resolved'],
            ['all', 'All'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={scope === id ? 'on' : ''}
            aria-selected={scope === id}
            onClick={() => setScope(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {busy ? <p className="muted">Loading…</p> : null}
      {!busy && items.length === 0 ? (
        <div className="incidents-empty">
          <p className="muted">
            {scope === 'active'
              ? 'No active incidents. Declare one in a group channel.'
              : 'Nothing here yet.'}
          </p>
        </div>
      ) : null}

      <ul className="incidents-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`incident-row sev-${item.severity}${
                item.status === 'resolved' ? ' is-resolved' : ''
              }`}
              onClick={() => onOpenChannel(item.conversationId)}
            >
              <span className={`incident-sev sev-${item.severity}`}>
                {item.severity.toUpperCase()}
              </span>
              <span className="incident-row-main">
                <strong>{item.title}</strong>
                <span className="muted">
                  {item.conversationName ?? 'Channel'} · {item.status}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
