import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useDirectory } from '../people/useDirectory';
import type { AuditEvent, ChatAnalytics, Paginated } from '../api/types';

type StatTone = 'live' | 'default' | 'muted';

function formatDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return isoDate.slice(5);
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatAction(action: string): string {
  const labels: Record<string, string> = {
    'auth.login': 'Signed in',
    'auth.registered': 'Registered',
    'invite.created': 'Invite created',
    'invite.accepted': 'Invite accepted',
    'member.role_changed': 'Member role changed',
    'member.removed': 'Member removed',
    'member.left': 'Left workspace',
    'org.created': 'Workspace created',
    'org.renamed': 'Workspace renamed',
    'org.deleted': 'Workspace deleted',
    'org.sso_updated': 'SSO settings updated',
    'org.billing_updated': 'Billing updated',
    'org.billing_checkout_started': 'Checkout started',
    'org.billing_portal_opened': 'Billing portal opened',
    'org.ownership_transferred': 'Ownership transferred',
    'conversation.created': 'Channel created',
    'conversation.deleted': 'Channel deleted',
    'conversation.joined': 'Joined channel',
    'conversation.left': 'Left channel',
    'conversation.members_added': 'Members added to channel',
    'conversation.member_removed': 'Member removed from channel',
    'message.sent': 'Message sent',
    'message.edited': 'Message edited',
    'message.deleted': 'Message deleted',
    'message.poll_created': 'Poll created',
    'message.scheduled': 'Message scheduled',
    'conversation.disappearing_updated': 'Disappearing messages updated',
    'workspace.updated': 'Workspace branding updated',
  };
  return labels[action] ?? action.replace(/[._]/g, ' ');
}

export function AnalyticsPage() {
  const { byUserId, ensureProfiles } = useDirectory();
  const [analytics, setAnalytics] = useState<ChatAnalytics | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [stats, log] = await Promise.all([
        api<ChatAnalytics>('/admin/analytics'),
        api<Paginated<AuditEvent>>('/admin/audit?page=1&limit=50'),
      ]);
      setAnalytics(stats.data);
      setAudit(log.data.items);
      void ensureProfiles([
        ...new Set(log.data.items.map((item) => item.actorId)),
      ]);
      setUpdatedAt(new Date());
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

  const maxDay = Math.max(
    ...(analytics?.messagesByDay.map((day) => day.count) ?? [0]),
    1,
  );

  const stats = useMemo(() => {
    if (!analytics) return [];
    return [
      {
        key: 'online',
        label: 'Online now',
        value: analytics.onlineUsers,
        hint: 'Live presence',
        tone: (analytics.onlineUsers > 0 ? 'live' : 'muted') as StatTone,
      },
      {
        key: 'today',
        label: 'Messages today',
        value: analytics.messagesToday,
        hint: 'Since midnight',
        tone: 'default' as StatTone,
      },
      {
        key: 'week',
        label: 'This week',
        value: analytics.messagesThisWeek,
        hint: 'Last 7 days',
        tone: 'default' as StatTone,
      },
      {
        key: 'total',
        label: 'Total messages',
        value: analytics.totalMessages,
        hint: 'All time',
        tone: 'default' as StatTone,
      },
      {
        key: 'conversations',
        label: 'Conversations',
        value: analytics.totalConversations,
        hint: 'Direct + groups',
        tone: 'default' as StatTone,
      },
      {
        key: 'active',
        label: 'Active chats today',
        value: analytics.activeConversationsToday,
        hint: 'With new messages',
        tone: 'default' as StatTone,
      },
    ];
  }, [analytics]);

  function actorLabel(actorId: string): string {
    const person = byUserId.get(actorId);
    if (!person) return `${actorId.slice(0, 8)}…`;
    return `${person.firstName} ${person.lastName}`.trim() || person.email;
  }

  return (
    <main className="page analytics-page">
      <header className="page-head analytics-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Analytics</h1>
          <p className="muted">
            Live workspace activity for demos and compliance reviews.
            {updatedAt ? (
              <>
                {' '}
                Updated {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
              </>
            ) : null}
          </p>
        </div>
        <button
          className="btn ghost"
          type="button"
          onClick={() => void load()}
          disabled={busy}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {!analytics && busy ? (
        <div className="analytics-loading muted">Loading workspace analytics…</div>
      ) : null}

      {analytics ? (
        <>
          <div className="stat-grid">
            {stats.map((stat) => (
              <article
                key={stat.key}
                className={`stat-card stat-card-${stat.tone}`}
              >
                <span className="stat-label">{stat.label}</span>
                <strong className="stat-value">{stat.value}</strong>
                <span className="stat-hint">{stat.hint}</span>
              </article>
            ))}
          </div>

          <div className="analytics-split">
            <section className="panel analytics-panel">
              <div className="panel-head">
                <div>
                  <h2>Messages — last 7 days</h2>
                  <p className="muted panel-sub">Daily volume across the workspace</p>
                </div>
              </div>
              <div className="bar-chart" role="img" aria-label="Messages by day">
                {analytics.messagesByDay.map((day) => {
                  const height =
                    day.count <= 0
                      ? 0
                      : Math.max(12, Math.round((day.count / maxDay) * 100));
                  return (
                    <div key={day.date} className="bar-col">
                      <span className="bar-count">{day.count}</span>
                      <div className="bar-track">
                        <div
                          className={`bar-fill${day.count === 0 ? ' is-empty' : ''}`}
                          style={{ height: `${height}%` }}
                          title={`${day.count} messages on ${day.date}`}
                        />
                      </div>
                      <small>{formatDayLabel(day.date)}</small>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel analytics-panel">
              <div className="panel-head">
                <div>
                  <h2>Top conversations</h2>
                  <p className="muted panel-sub">Highest message volume</p>
                </div>
              </div>
              {analytics.topConversations.length === 0 ? (
                <p className="muted analytics-empty">No conversations yet.</p>
              ) : (
                <ul className="analytics-rank">
                  {analytics.topConversations.map((row, index) => (
                    <li key={row.conversationId}>
                      <span className="rank-index">{index + 1}</span>
                      <div className="rank-body">
                        <strong>
                          {row.name ??
                            (row.type === 'group' ? 'Group chat' : 'Direct')}
                        </strong>
                        <span className="muted">
                          {row.type === 'group' ? 'Group' : 'Direct message'}
                        </span>
                      </div>
                      <span className="rank-count">{row.messageCount}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}

      <section className="panel analytics-panel">
        <div className="panel-head">
          <div>
            <h2>Audit log</h2>
            <p className="muted panel-sub">
              Security and admin actions (sign-in, invites, roles, SSO, billing,
              channel changes)
            </p>
          </div>
          <button className="btn ghost" type="button" onClick={() => void exportAudit()}>
            Export CSV
          </button>
        </div>
        {audit.length === 0 ? (
          <p className="muted analytics-empty">No audit events yet.</p>
        ) : (
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
                    <td className="audit-when">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td>{actorLabel(item.actorId)}</td>
                    <td>
                      <span className="audit-action">{formatAction(item.action)}</span>
                    </td>
                    <td className="muted">
                      {item.targetType
                        ? `${item.targetType}${
                            item.targetId ? ` · ${item.targetId.slice(0, 8)}…` : ''
                          }`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
