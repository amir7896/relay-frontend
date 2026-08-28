import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useDirectory } from '../people/useDirectory';
import type { AuditEvent, ChatAnalytics, Paginated } from '../api/types';

export function AnalyticsPage() {
  const { ensureProfiles } = useDirectory();
  const [analytics, setAnalytics] = useState<ChatAnalytics | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [stats, log] = await Promise.all([
        api<ChatAnalytics>('/admin/analytics'),
        api<Paginated<AuditEvent>>('/admin/audit?page=1&limit=20'),
      ]);
      setAnalytics(stats.data);
      setAudit(log.data.items);
      void ensureProfiles([
        ...new Set(log.data.items.map((item) => item.actorId)),
      ]);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load analytics');
    } finally {
      setBusy(false);
    }
  }, [ensureProfiles]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function exportAudit() {
    const response = await api<{ csv: string }>('/admin/audit/export');
    const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `relay-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const maxDay = Math.max(...(analytics?.messagesByDay.map((d) => d.count) ?? [1]), 1);

  return (
    <main className="page analytics-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Analytics</h1>
          <p className="muted">Live workspace activity for demos and compliance reviews.</p>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {analytics ? (
        <>
          <div className="stat-grid">
            <article className="stat-card">
              <span>Online now</span>
              <strong>{analytics.onlineUsers}</strong>
            </article>
            <article className="stat-card">
              <span>Messages today</span>
              <strong>{analytics.messagesToday}</strong>
            </article>
            <article className="stat-card">
              <span>This week</span>
              <strong>{analytics.messagesThisWeek}</strong>
            </article>
            <article className="stat-card">
              <span>Total messages</span>
              <strong>{analytics.totalMessages}</strong>
            </article>
            <article className="stat-card">
              <span>Conversations</span>
              <strong>{analytics.totalConversations}</strong>
            </article>
            <article className="stat-card">
              <span>Active chats today</span>
              <strong>{analytics.activeConversationsToday}</strong>
            </article>
          </div>

          <section className="panel">
            <h2>Messages — last 7 days</h2>
            <div className="bar-chart">
              {analytics.messagesByDay.map((day) => (
                <div key={day.date} className="bar-col">
                  <div
                    className="bar-fill"
                    style={{ height: `${Math.round((day.count / maxDay) * 100)}%` }}
                    title={`${day.count} messages`}
                  />
                  <small>{day.date.slice(5)}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Top conversations</h2>
            <ul className="simple-list">
              {analytics.topConversations.map((row) => (
                <li key={row.conversationId}>
                  <strong>{row.name ?? (row.type === 'group' ? 'Group chat' : 'Direct')}</strong>
                  <span>{row.messageCount} messages</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>Audit log</h2>
          <button className="btn ghost" type="button" onClick={() => void exportAudit()}>
            Export CSV
          </button>
        </div>
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>{item.actorId.slice(0, 8)}…</td>
                  <td>{item.action}</td>
                  <td>{item.targetType ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
