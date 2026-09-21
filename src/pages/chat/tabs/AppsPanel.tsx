import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import type { AppCatalogItem, Conversation, InstalledApp } from '../../../api/types';
import { MrkdwnEditor } from '../../../components/MrkdwnEditor';

const BOT_KEYS = new Set(['standup', 'dsu', 'daily-meeting']);

const DEFAULT_QUESTIONS: Record<string, string[]> = {
  standup: [
    'What did you do yesterday?',
    'What will you do today?',
    'Any blockers?',
  ],
  dsu: [
    'Yesterday’s progress?',
    'Today’s plan?',
    'Blockers or risks?',
  ],
  'daily-meeting': [
    'Ready for the meeting?',
    'Anything to add to the agenda?',
    'Any decisions needed today?',
  ],
};

const WEEKDAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

type IntegrationConfig = {
  defaultRepo?: string;
  defaultProjectKey?: string;
  eventsConversationId?: string;
};

type BotConfig = {
  conversationId: string;
  time: string;
  timezone: string;
  weekdays: number[];
  questions: string[];
  summaryOffsetMinutes: number;
};

function emptyConfig(appKey: string, channelId: string): BotConfig {
  return {
    conversationId: channelId,
    time: '09:30',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    weekdays: [1, 2, 3, 4, 5],
    questions: [...(DEFAULT_QUESTIONS[appKey] || DEFAULT_QUESTIONS.standup)],
    summaryOffsetMinutes: 480,
  };
}

export function AppsPanel({ conversationId }: { conversationId: string }) {
  const [apps, setApps] = useState<AppCatalogItem[]>([]);
  const [installed, setInstalled] = useState<InstalledApp[]>([]);
  const [channels, setChannels] = useState<Conversation[]>([]);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configKey, setConfigKey] = useState('');
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [integrationKey, setIntegrationKey] = useState('');
  const [integrationConfig, setIntegrationConfig] =
    useState<IntegrationConfig | null>(null);

  const installedMap = useMemo(() => {
    const map = new Map<string, InstalledApp>();
    for (const app of installed) {
      map.set(app.key || app.appKey, app);
    }
    return map;
  }, [installed]);

  async function refresh() {
    const [catalog, current, inbox] = await Promise.all([
      api<AppCatalogItem[]>('/chat/apps'),
      api<InstalledApp[]>('/chat/apps/installed'),
      api<{ items: Conversation[] }>('/chat/conversations?page=1&limit=100'),
    ]);
    setApps(catalog.data ?? []);
    setInstalled(current.data ?? []);
    setChannels(
      (inbox.data?.items ?? []).filter((item) => item.type === 'group'),
    );
  }

  useEffect(() => {
    let active = true;
    refresh()
      .catch(() => {
        if (active) setError('The app catalog is not available yet.');
      });
    return () => {
      active = false;
    };
  }, []);

  function openConfig(app: AppCatalogItem) {
    const existing = installedMap.get(app.key);
    const raw = (existing?.config || {}) as Partial<BotConfig>;
    setConfigKey(app.key);
    setConfig({
      ...emptyConfig(app.key, conversationId),
      ...raw,
      conversationId: raw.conversationId || conversationId,
      questions:
        Array.isArray(raw.questions) && raw.questions.length
          ? raw.questions
          : emptyConfig(app.key, conversationId).questions,
      weekdays:
        Array.isArray(raw.weekdays) && raw.weekdays.length
          ? raw.weekdays
          : [1, 2, 3, 4, 5],
    });
    setNotice('');
    setError('');
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!configKey || !config) return;
    setBusyKey(configKey);
    setError('');
    try {
      const cleanedQuestions = config.questions
        .map((line) => line.trim())
        .filter(Boolean);
      if (!cleanedQuestions.length) {
        setError('Add at least one question.');
        return;
      }
      await api(`/chat/apps/${encodeURIComponent(configKey)}/install`, {
        method: 'POST',
        body: JSON.stringify({
          config: { ...config, questions: cleanedQuestions },
        }),
      });
      await refresh();
      setNotice(`${configKey} saved. It will post at ${config.time} (${config.timezone}).`);
      setConfigKey('');
      setConfig(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save bot settings.');
    } finally {
      setBusyKey('');
    }
  }

  async function uninstall(appKey: string) {
    setBusyKey(appKey);
    setError('');
    try {
      await api(`/chat/apps/${encodeURIComponent(appKey)}/install`, {
        method: 'DELETE',
      });
      await refresh();
      setNotice('App uninstalled.');
      if (configKey === appKey) {
        setConfigKey('');
        setConfig(null);
      }
    } catch {
      setError('Could not uninstall the app.');
    } finally {
      setBusyKey('');
    }
  }

  async function installIntegration(app: AppCatalogItem) {
    setBusyKey(app.key);
    setError('');
    try {
      if (app.oauthRequired) {
        const started = await api<{ authorizeUrl: string }>(
          `/chat/apps/${encodeURIComponent(app.key)}/oauth/start?returnPath=${encodeURIComponent(`/chat/${conversationId}`)}`,
        );
        window.location.href = started.data.authorizeUrl;
        return;
      }
      await api(`/chat/apps/${encodeURIComponent(app.key)}/install`, {
        method: 'POST',
        body: JSON.stringify({ config: {} }),
      });
      await refresh();
      setNotice(`${app.name} installed.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not connect ${app.name}.`,
      );
    } finally {
      setBusyKey('');
    }
  }

  function openIntegrationConfig(app: AppCatalogItem) {
    const existing = installedMap.get(app.key);
    const raw = (existing?.config || {}) as IntegrationConfig;
    setIntegrationKey(app.key);
    setIntegrationConfig({
      defaultRepo: raw.defaultRepo || '',
      defaultProjectKey: raw.defaultProjectKey || '',
      eventsConversationId: raw.eventsConversationId || conversationId,
    });
    setNotice('');
    setError('');
  }

  async function saveIntegrationConfig(event: FormEvent) {
    event.preventDefault();
    if (!integrationKey || !integrationConfig) return;
    setBusyKey(integrationKey);
    setError('');
    try {
      await api(`/chat/apps/${encodeURIComponent(integrationKey)}/install`, {
        method: 'POST',
        body: JSON.stringify({ config: integrationConfig }),
      });
      await refresh();
      setNotice('Integration settings saved.');
      setIntegrationKey('');
      setIntegrationConfig(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save integration settings.',
      );
    } finally {
      setBusyKey('');
    }
  }

  async function startZoomMeeting() {
    setBusyKey('zoom');
    setError('');
    try {
      await api(`/chat/conversations/${conversationId}/apps/zoom/meetings`, {
        method: 'POST',
        body: JSON.stringify({ topic: 'Relay meeting' }),
      });
      setNotice('Zoom meeting posted in this channel.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Zoom meeting.');
    } finally {
      setBusyKey('');
    }
  }

  async function postNow(appKey: string) {
    setBusyKey(appKey);
    setError('');
    try {
      const installed = installedMap.get(appKey);
      const targetId =
        (installed?.config as BotConfig | undefined)?.conversationId ||
        conversationId;
      await api(`/chat/apps/${encodeURIComponent(appKey)}/run`, {
        method: 'POST',
        body: JSON.stringify({ conversationId: targetId }),
      });
      setNotice(
        'Posted now in the channel — open Messages to reply in the thread. The daily schedule still runs separately at the configured time.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post standup.');
    } finally {
      setBusyKey('');
    }
  }

  function formatBotSchedule(config: BotConfig | undefined) {
    if (!config?.time) return null;
    const days = Array.isArray(config.weekdays) ? config.weekdays : [1, 2, 3, 4, 5];
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayText = days
      .slice()
      .sort((a, b) => a - b)
      .map((d) => labels[d] ?? '?')
      .join('·');
    return `Auto: ${dayText} at ${config.time} (${config.timezone || 'UTC'})`;
  }

  const bots = apps.filter((app) => app.category === 'bot' || BOT_KEYS.has(app.key));
  const integrations = apps.filter(
    (app) => app.category !== 'bot' && !BOT_KEYS.has(app.key),
  );

  return (
    <section className="feature-panel apps-panel">
      <div className="feature-panel-head">
        <div>
          <h3>Apps</h3>
          <p className="muted">
            Schedule bots to post on selected weekdays at the set time, or use{' '}
            <strong>Post now</strong> to send a prompt immediately.
          </p>
        </div>
      </div>
      {error ? <p className="error tab-notice">{error}</p> : null}
      {notice ? (
        <p className="muted tab-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div
        className={`apps-layout${
          (config && configKey) || (integrationConfig && integrationKey)
            ? ' has-config'
            : ''
        }`}
      >
        {config && configKey ? (
          <form className="app-config-card" onSubmit={saveConfig}>
            <div className="app-config-head">
              <h4>
                Configure {apps.find((app) => app.key === configKey)?.name}
              </h4>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setConfigKey('');
                  setConfig(null);
                }}
              >
                Cancel
              </button>
            </div>
            <label>
              Channel
              <select
                value={config.conversationId}
                onChange={(event) =>
                  setConfig({ ...config, conversationId: event.target.value })
                }
                required
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name || 'channel'}
                  </option>
                ))}
              </select>
            </label>
            <div className="app-config-row">
              <label>
                Post time
                <input
                  type="time"
                  value={config.time}
                  onChange={(event) =>
                    setConfig({ ...config, time: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Timezone
                <input
                  value={config.timezone}
                  onChange={(event) =>
                    setConfig({ ...config, timezone: event.target.value })
                  }
                  placeholder="Asia/Karachi"
                  required
                />
              </label>
            </div>
            <fieldset className="app-weekday-set">
              <legend>Weekdays</legend>
              <div className="app-weekday-row">
                {WEEKDAYS.map((day) => {
                  const checked = config.weekdays.includes(day.id);
                  return (
                    <label key={day.id} className={checked ? 'on' : ''}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? config.weekdays.filter((id) => id !== day.id)
                            : [...config.weekdays, day.id];
                          setConfig({ ...config, weekdays: next });
                        }}
                      />
                      {day.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <MrkdwnEditor
              label="Questions (one per line)"
              rows={5}
              value={config.questions.join('\n')}
              onChange={(next) =>
                setConfig({
                  ...config,
                  // Keep blank lines while typing so Enter can start a new question.
                  questions: next.split('\n'),
                })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.stopPropagation();
                }
              }}
              hint="Format with the toolbar or shortcuts — *bold* _italic_ · one question per line"
            />
            <label>
              Auto-summary after (minutes)
              <input
                type="number"
                min={30}
                max={1440}
                value={config.summaryOffsetMinutes}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    summaryOffsetMinutes: Number(event.target.value) || 480,
                  })
                }
              />
            </label>
            <div className="app-config-actions">
              <button
                className="btn"
                type="submit"
                disabled={busyKey === configKey}
              >
                {busyKey === configKey ? 'Saving…' : 'Save & install'}
              </button>
              <p className="muted">
                <strong>1.</strong> Click <strong>Save &amp; install</strong> or
                the schedule does not change.{' '}
                <strong>2.</strong> Auto-post runs once on each selected weekday
                at this time (timezone above), within ~15 minutes after that
                minute. <strong>3.</strong> Use <strong>Post now</strong> on the
                bot card below for an immediate test (not the schedule). Team
                replies in the thread or with <code>/standup …</code>
              </p>
            </div>
          </form>
        ) : null}

        {integrationConfig && integrationKey ? (
          <form className="app-config-card" onSubmit={saveIntegrationConfig}>
            <div className="app-config-head">
              <h4>
                Configure{' '}
                {apps.find((app) => app.key === integrationKey)?.name ||
                  integrationKey}
              </h4>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setIntegrationKey('');
                  setIntegrationConfig(null);
                }}
              >
                Cancel
              </button>
            </div>
            {integrationKey === 'github' ? (
              <label>
                Default repository (owner/name)
                <input
                  value={integrationConfig.defaultRepo || ''}
                  onChange={(event) =>
                    setIntegrationConfig({
                      ...integrationConfig,
                      defaultRepo: event.target.value,
                    })
                  }
                  placeholder="acme/relay"
                />
              </label>
            ) : null}
            {integrationKey === 'jira' ? (
              <label>
                Default project key
                <input
                  value={integrationConfig.defaultProjectKey || ''}
                  onChange={(event) =>
                    setIntegrationConfig({
                      ...integrationConfig,
                      defaultProjectKey: event.target.value.toUpperCase(),
                    })
                  }
                  placeholder="ENG"
                />
              </label>
            ) : null}
            {integrationKey === 'github' || integrationKey === 'jira' ? (
              <label>
                Events channel
                <select
                  value={
                    integrationConfig.eventsConversationId || conversationId
                  }
                  onChange={(event) =>
                    setIntegrationConfig({
                      ...integrationConfig,
                      eventsConversationId: event.target.value,
                    })
                  }
                >
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name || 'channel'}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="muted">
              Webhook URL:{' '}
              <code>/api/chat/integrations/{integrationKey}/events</code> (send{' '}
              <code>X-Organization-Id</code>)
            </p>
            <div className="app-config-actions">
              <button
                className="btn"
                type="submit"
                disabled={busyKey === integrationKey}
              >
                {busyKey === integrationKey ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        ) : null}

        <div className="apps-catalog">
          <h4 className="apps-section-title">Bots</h4>
          <div className="apps-grid">
            {bots.map((app) => {
              const isInstalled = installedMap.has(app.key);
              return (
                <article key={app.key} className="app-card app-card-bot">
                  <div className="app-card-main">
                    <span className="app-card-icon">
                      {app.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="app-card-body">
                      <h4>{app.name}</h4>
                      <p className="muted">{app.description}</p>
                      {isInstalled ? (
                        <p className="app-card-meta">
                          {formatBotSchedule(
                            installedMap.get(app.key)?.config as BotConfig,
                          ) || 'Installed'}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="app-card-actions">
                    <button
                      className="btn"
                      type="button"
                      disabled={busyKey === app.key}
                      onClick={() => openConfig(app)}
                    >
                      {isInstalled ? 'Configure' : 'Set up'}
                    </button>
                    {isInstalled ? (
                      <>
                        <button
                          className="ghost"
                          type="button"
                          title="Post a standup prompt in the channel immediately (does not wait for the schedule)"
                          disabled={busyKey === app.key}
                          onClick={() => void postNow(app.key)}
                        >
                          {busyKey === app.key ? 'Posting…' : 'Post now'}
                        </button>
                        <button
                          className="ghost danger-link"
                          type="button"
                          disabled={busyKey === app.key}
                          onClick={() => void uninstall(app.key)}
                        >
                          Uninstall
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <h4 className="apps-section-title">Integrations</h4>
          <div className="apps-grid">
            {integrations.map((app) => {
              const installedApp = installedMap.get(app.key);
              const connected = Boolean(app.connected || installedApp?.connected);
              return (
                <article key={app.key} className="app-card">
                  <div className="app-card-main">
                    <span className="app-card-icon">
                      {app.iconUrl ? (
                        <img src={app.iconUrl} alt="" />
                      ) : (
                        app.name.slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <div className="app-card-body">
                      <h4>{app.name}</h4>
                      <p className="muted">
                        {app.description || 'Workspace integration'}
                      </p>
                      {connected ? (
                        <p className="app-card-meta">
                          Connected
                          {app.providerAccountName ||
                          installedApp?.providerAccountName
                            ? ` · ${
                                app.providerAccountName ||
                                installedApp?.providerAccountName
                              }`
                            : ''}
                        </p>
                      ) : (
                        <p className="app-card-meta">OAuth required</p>
                      )}
                    </div>
                  </div>
                  <div className="app-card-actions">
                    {connected ? (
                      <>
                        <button
                          className="ghost"
                          type="button"
                          onClick={() => openIntegrationConfig(app)}
                        >
                          Settings
                        </button>
                        {app.key === 'zoom' ? (
                          <button
                            className="ghost"
                            type="button"
                            disabled={busyKey === 'zoom'}
                            onClick={() => void startZoomMeeting()}
                          >
                            Start meeting
                          </button>
                        ) : null}
                        <button
                          className="ghost danger-link"
                          type="button"
                          disabled={busyKey === app.key}
                          onClick={() => void uninstall(app.key)}
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn"
                        type="button"
                        disabled={busyKey === app.key}
                        onClick={() => void installIntegration(app)}
                      >
                        {busyKey === app.key ? 'Working…' : 'Connect'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {!error && apps.length === 0 ? (
            <p className="muted tab-empty">No apps in the catalog.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
