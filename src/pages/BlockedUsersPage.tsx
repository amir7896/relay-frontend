import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { BlockView, Paginated } from '../api/types';
import { useConfirm } from '../components/ConfirmProvider';
import { displayName, initials } from '../lib/format';
import { useDirectory } from '../people/useDirectory';
import { resolveMediaUrl } from '../components/VoiceNotePlayer';

export function BlockedUsersPage() {
  const { byUserId, ensureProfiles } = useDirectory();
  const askConfirm = useConfirm();
  const [blocks, setBlocks] = useState<BlockView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api<Paginated<BlockView>>(
        '/chat/blocks?page=1&limit=100',
      );
      const items = response.data.items ?? [];
      setBlocks(items);
      await ensureProfiles(items.map((item) => item.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load blocked users');
      setBlocks([]);
    } finally {
      setLoading(false);
    }
  }, [ensureProfiles]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const sorted = [...blocks].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (!term) {
      return sorted;
    }
    return sorted.filter((block) => {
      const person = byUserId.get(block.userId);
      const haystack = [
        displayName(person),
        person?.email ?? '',
        block.userId,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [blocks, byUserId, query]);

  async function unblock(userId: string) {
    const person = byUserId.get(userId);
    const label = displayName(person);
    const ok = await askConfirm({
      title: 'Unblock user',
      message: `Unblock ${label}? They will be able to message you again.`,
      confirmLabel: 'Unblock',
      cancelLabel: 'Cancel',
    });
    if (!ok) {
      return;
    }
    setBusyId(userId);
    setNotice('');
    setError('');
    try {
      await api(`/chat/blocks/${userId}`, { method: 'DELETE' });
      setBlocks((current) => current.filter((item) => item.userId !== userId));
      setNotice(`${label} was unblocked.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unblock user');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="page blocked-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Privacy</p>
          <h1>Blocked users</h1>
          <p className="muted">
            People you blocked cannot message you or start private calls. Unblock anytime.
          </p>
        </div>
        <div className="blocked-head-actions">
          <button className="ghost" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link className="ghost" to="/profile">
            Back to profile
          </Link>
        </div>
      </div>

      <div className="blocked-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search blocked people"
          aria-label="Search blocked people"
        />
        <span className="muted blocked-count">
          {blocks.length === 0
            ? 'None blocked'
            : `${blocks.length} blocked`}
        </span>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      {loading && blocks.length === 0 ? (
        <p className="muted empty">Loading blocked users…</p>
      ) : filtered.length === 0 ? (
        <section className="panel blocked-empty">
          <h2>{query.trim() ? 'No matches' : 'No blocked users'}</h2>
          <p className="muted">
            {query.trim()
              ? 'Try a different name or email.'
              : 'When you block someone from a chat, they will show up here.'}
          </p>
          <Link className="btn" to="/chat">
            Open messages
          </Link>
        </section>
      ) : (
        <ul className="blocked-list">
          {filtered.map((block) => {
            const person = byUserId.get(block.userId);
            const name = displayName(person);
            const avatar = person?.avatar ? resolveMediaUrl(person.avatar) : null;
            return (
              <li key={block.userId} className="blocked-row">
                <div className="blocked-identity">
                  {avatar ? (
                    <img className="avatar sm" src={avatar} alt="" />
                  ) : (
                    <div className="avatar sm">{initials(name)}</div>
                  )}
                  <div className="blocked-meta">
                    <strong>{name}</strong>
                    <small>{person?.email || 'Profile unavailable'}</small>
                    <small>
                      Blocked{' '}
                      {new Date(block.createdAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </small>
                  </div>
                </div>
                <button
                  className="btn"
                  type="button"
                  disabled={busyId === block.userId}
                  onClick={() => void unblock(block.userId)}
                >
                  {busyId === block.userId ? 'Unblocking…' : 'Unblock'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
