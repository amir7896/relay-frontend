import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { WikiPage } from '../../api/types';
import { useConfirm } from '../../components/ConfirmProvider';

type Props = {
  onShareHint?: (slug: string) => void;
};

export function WikiView({ onShareHint }: Props) {
  const confirmDialog = useConfirm();
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [body, setBody] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [shareTip, setShareTip] = useState('');

  const load = useCallback(async (q?: string) => {
    setBusy(true);
    setError('');
    try {
      const qs = q?.trim()
        ? `?q=${encodeURIComponent(q.trim())}`
        : '';
      const response = await api<WikiPage[]>(`/chat/wiki-pages${qs}`);
      setPages(response.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load wiki');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => pages.find((page) => page.id === selectedId) ?? null,
    [pages, selectedId],
  );

  useEffect(() => {
    if (!selected || editing || creating) return;
    setTitle(selected.title);
    setSlug(selected.slug);
    setBody(selected.body);
  }, [selected, editing, creating]);

  function startCreate() {
    setCreating(true);
    setEditing(true);
    setSelectedId(null);
    setTitle('');
    setSlug('');
    setBody('# New page\n\nWrite your workspace notes here…\n');
    setError('');
  }

  function startEdit() {
    if (!selected) return;
    setCreating(false);
    setEditing(true);
    setTitle(selected.title);
    setSlug(selected.slug);
    setBody(selected.body);
    setError('');
  }

  function cancelEdit() {
    setCreating(false);
    setEditing(false);
    setError('');
    if (selected) {
      setTitle(selected.title);
      setSlug(selected.slug);
      setBody(selected.body);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const nextTitle = title.trim();
    const nextBody = body.trim();
    if (!nextTitle || !nextBody) {
      setError('Title and body are required');
      return;
    }
    setSaveBusy(true);
    setError('');
    try {
      if (creating) {
        const response = await api<WikiPage>('/chat/wiki-pages', {
          method: 'POST',
          body: JSON.stringify({
            title: nextTitle,
            body: nextBody,
            slug: slug.trim() || undefined,
          }),
        });
        setPages((current) => [response.data, ...current]);
        setSelectedId(response.data.id);
      } else if (selected) {
        const response = await api<WikiPage>(
          `/chat/wiki-pages/${selected.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              title: nextTitle,
              body: nextBody,
              slug: slug.trim() || undefined,
            }),
          },
        );
        setPages((current) =>
          current.map((page) =>
            page.id === response.data.id ? response.data : page,
          ),
        );
      }
      setCreating(false);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save page');
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    const ok = await confirmDialog({
      title: 'Delete wiki page?',
      message: `Delete “${selected.title}”? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setSaveBusy(true);
    setError('');
    try {
      await api(`/chat/wiki-pages/${selected.id}`, { method: 'DELETE' });
      setPages((current) => current.filter((page) => page.id !== selected.id));
      setSelectedId(null);
      setEditing(false);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete page');
    } finally {
      setSaveBusy(false);
    }
  }

  async function runSearch() {
    await load(query);
  }

  return (
    <div className="wiki-panel">
      <header className="wiki-panel-head">
        <div>
          <h3>Wiki</h3>
          <p className="muted">
            Workspace knowledge — shared docs beyond channel Canvas. Share into
            chat with <code>/wiki share slug</code>.
          </p>
        </div>
        <button type="button" className="btn" onClick={startCreate}>
          New page
        </button>
      </header>

      <div className="wiki-layout">
        <aside className="wiki-sidebar" aria-label="Wiki pages">
          <div className="wiki-search">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="Search pages…"
              aria-label="Search wiki pages"
            />
            <button
              type="button"
              className="ghost"
              onClick={() => void runSearch()}
              disabled={busy}
            >
              Search
            </button>
          </div>
          {busy ? <p className="muted">Loading…</p> : null}
          {!busy && pages.length === 0 ? (
            <div className="wiki-empty">
              <p className="muted">
                {query.trim()
                  ? `No pages match “${query.trim()}”.`
                  : 'No pages yet — create an onboarding or runbook doc.'}
              </p>
            </div>
          ) : null}
          <ul className="wiki-page-list">
            {pages.map((page) => (
              <li key={page.id}>
                <button
                  type="button"
                  className={`wiki-page-row${
                    page.id === selectedId && !creating ? ' is-active' : ''
                  }`}
                  onClick={() => {
                    setSelectedId(page.id);
                    setCreating(false);
                    setEditing(false);
                  }}
                >
                  <strong>{page.title}</strong>
                  <span className="muted">{page.slug}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="wiki-editor" aria-label="Wiki page">
          {error ? <p className="error">{error}</p> : null}
          {shareTip ? <p className="wiki-share-tip">{shareTip}</p> : null}
          {!selected && !creating ? (
            <div className="wiki-empty wiki-empty-main">
              <p className="muted">
                Select a page or create one. Tip: from any channel run{' '}
                <code>/wiki list</code> or <code>/wiki share onboarding</code>.
              </p>
            </div>
          ) : editing ? (
            <form className="wiki-form" onSubmit={(event) => void handleSave(event)}>
              <label>
                Title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  required
                  autoFocus
                />
              </label>
              <label>
                Slug <span className="muted">(optional)</span>
                <input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  maxLength={80}
                  placeholder="auto-from-title"
                />
              </label>
              <label>
                Body
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={16}
                  maxLength={20000}
                  required
                />
              </label>
              <div className="wiki-form-actions">
                <button type="submit" className="btn" disabled={saveBusy}>
                  {saveBusy ? 'Saving…' : creating ? 'Create' : 'Save'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={cancelEdit}
                  disabled={saveBusy}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : selected ? (
            <article className="wiki-article">
              <header className="wiki-article-head">
                <div>
                  <h4>{selected.title}</h4>
                  <p className="muted">
                    <code>{selected.slug}</code>
                    {' · '}
                    Updated {new Date(selected.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="wiki-article-actions">
                  <button type="button" className="ghost" onClick={startEdit}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const tip = `/wiki share ${selected.slug}`;
                      setShareTip(
                        `In any channel, send: ${tip}`,
                      );
                      onShareHint?.(selected.slug);
                      void navigator.clipboard?.writeText(tip).catch(() => undefined);
                    }}
                    title="Copy /wiki share command"
                  >
                    Copy share
                  </button>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={() => void handleDelete()}
                    disabled={saveBusy}
                  >
                    Delete
                  </button>
                </div>
              </header>
              <pre className="wiki-article-body">{selected.body}</pre>
            </article>
          ) : null}
        </section>
      </div>
    </div>
  );
}
