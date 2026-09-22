import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import type { Paginated, SlashCommand } from '../../../api/types';
import { useOrganization } from '../../../organizations/OrganizationContext';

type Props = {
  onTryCommand?: (commandName: string) => void;
};

type Draft = {
  name: string;
  description: string;
  responseTemplate: string;
  responseMode: 'in_channel' | 'ephemeral';
  requestUrl: string;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  responseTemplate: '',
  responseMode: 'in_channel',
  requestUrl: '',
};

const STARTER_PACKS: Array<Draft & { blurb: string }> = [
  {
    name: 'ship',
    description: 'Announce a release or deploy',
    responseTemplate: '🚢 Shipping: {text}',
    responseMode: 'in_channel',
    requestUrl: '',
    blurb: 'Post a ship note with your text.',
  },
  {
    name: 'brb',
    description: 'Tell the channel you will be right back',
    responseTemplate: '⏳ {user} will be right back{text}',
    responseMode: 'in_channel',
    requestUrl: '',
    blurb: 'Quick away notice.',
  },
  {
    name: 'note',
    description: 'Leave a private note only you can see',
    responseTemplate: '📝 Note saved: {text}',
    responseMode: 'ephemeral',
    requestUrl: '',
    blurb: 'Ephemeral — only you see the reply.',
  },
];

function normalizeName(value: string) {
  return value
    .trim()
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
}

export function SlashMarketplacePanel({ onTryCommand }: Props) {
  const { organizations, activeOrganizationId } = useOrganization();
  const activeOrg =
    organizations.find((org) => org.id === activeOrganizationId) ??
    organizations[0];
  const canManage =
    activeOrg?.role === 'owner' || activeOrg?.role === 'admin';

  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'builtin' | 'custom'>('all');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadCommands = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await api<Paginated<SlashCommand>>(
        '/chat/slash-commands?page=1&limit=100',
      );
      setCommands(response.data.items ?? []);
    } catch (err) {
      setCommands([]);
      setError(
        err instanceof Error ? err.message : 'Could not load slash commands',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadCommands();
  }, [loadCommands]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands.filter((item) => {
      if (filter === 'builtin' && !item.builtin) return false;
      if (filter === 'custom' && item.builtin) return false;
      if (!q) return true;
      return (
        item.name.includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.responseTemplate.toLowerCase().includes(q)
      );
    });
  }, [commands, filter, query]);

  const customCount = commands.filter((item) => !item.builtin).length;
  const existingNames = useMemo(
    () => new Set(commands.map((item) => item.name.toLowerCase())),
    [commands],
  );

  async function createCommand(payload: Draft) {
    const name = normalizeName(payload.name);
    if (!name) {
      setError('Command name is required.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<SlashCommand>('/chat/slash-commands', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: payload.description.trim(),
          responseTemplate: payload.responseTemplate.trim() || undefined,
          responseMode: payload.responseMode,
          requestUrl: payload.requestUrl.trim() || undefined,
        }),
      });
      setDraft(EMPTY_DRAFT);
      setShowCreate(false);
      setNotice(`/${name} is ready — type it in the composer.`);
      await loadCommands();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create command');
    } finally {
      setBusy(false);
    }
  }

  async function revokeCommand(command: SlashCommand) {
    if (command.builtin) return;
    setBusy(true);
    setError('');
    try {
      await api(`/chat/slash-commands/${command.id}`, { method: 'DELETE' });
      setNotice(`/${command.name} removed.`);
      await loadCommands();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove command');
    } finally {
      setBusy(false);
    }
  }

  function tryCommand(name: string) {
    onTryCommand?.(name);
    setNotice(`Inserted /${name} into the message composer.`);
  }

  return (
    <div className="slash-market">
      <header className="slash-market-head">
        <div>
          <h4>Slash command marketplace</h4>
          <p className="muted">
            Built-ins plus custom commands for this workspace. Templates support{' '}
            <code>{'{text}'}</code> and <code>{'{user}'}</code>.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setShowCreate((open) => !open);
              setError('');
            }}
          >
            {showCreate ? 'Close form' : 'Create command'}
          </button>
        ) : null}
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? (
        <p className="muted tab-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="slash-market-starters">
        <p className="apps-section-title">Quick add</p>
        <div className="slash-starter-grid">
          {STARTER_PACKS.map((pack) => {
            const taken = existingNames.has(pack.name);
            return (
              <article key={pack.name} className="slash-starter-card">
                <div>
                  <strong>/{pack.name}</strong>
                  <p className="muted">{pack.blurb}</p>
                </div>
                <button
                  type="button"
                  className="ghost"
                  disabled={!canManage || taken || busy}
                  onClick={() => void createCommand(pack)}
                >
                  {taken ? 'Installed' : 'Add'}
                </button>
              </article>
            );
          })}
        </div>
        {!canManage ? (
          <p className="muted slash-market-hint">
            Ask a workspace owner or admin to install custom commands.
          </p>
        ) : null}
      </div>

      {showCreate && canManage ? (
        <form
          className="slash-create-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void createCommand(draft);
          }}
        >
          <label>
            Command
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="deploy"
              maxLength={32}
              required
            />
          </label>
          <label>
            Description
            <input
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Announce a deploy"
              maxLength={160}
              required
            />
          </label>
          <label>
            Response mode
            <select
              value={draft.responseMode}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  responseMode: event.target.value as Draft['responseMode'],
                }))
              }
            >
              <option value="in_channel">In channel</option>
              <option value="ephemeral">Ephemeral (only you)</option>
            </select>
          </label>
          <label className="slash-create-span">
            Response template
            <input
              value={draft.responseTemplate}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  responseTemplate: event.target.value,
                }))
              }
              placeholder="Shipping: {text}"
              maxLength={2000}
            />
          </label>
          <label className="slash-create-span">
            HTTPS handler URL (optional)
            <input
              value={draft.requestUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  requestUrl: event.target.value,
                }))
              }
              placeholder="https://example.com/slash/deploy"
              maxLength={500}
            />
          </label>
          <div className="slash-create-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Publish command'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="slash-market-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search commands…"
          aria-label="Search slash commands"
        />
        <div className="slash-filter-chips" role="tablist" aria-label="Filter">
          {(
            [
              ['all', 'All'],
              ['builtin', 'Built-in'],
              ['custom', `Custom (${customCount})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={filter === id ? 'on' : ''}
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {busy && commands.length === 0 ? (
        <p className="muted">Loading commands…</p>
      ) : null}
      {!busy && filtered.length === 0 ? (
        <p className="muted">No commands match.</p>
      ) : null}

      <ul className="slash-command-grid">
        {filtered.map((command) => (
          <li key={command.id} className="slash-command-card">
            <div className="slash-command-card-top">
              <strong>/{command.name}</strong>
              <span
                className={`slash-command-badge${
                  command.builtin ? ' is-builtin' : ' is-custom'
                }`}
              >
                {command.builtin ? 'Built-in' : command.responseMode}
              </span>
            </div>
            <p>{command.description}</p>
            {command.responseTemplate ? (
              <code className="slash-command-template">
                {command.responseTemplate}
              </code>
            ) : null}
            {command.requestUrl ? (
              <small className="muted">Webhook · {command.requestUrl}</small>
            ) : null}
            <div className="slash-command-actions">
              <button
                type="button"
                className="btn"
                onClick={() => tryCommand(command.name)}
              >
                Try in chat
              </button>
              {!command.builtin && canManage ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void revokeCommand(command)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
