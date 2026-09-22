import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { UserAvatar } from '../../../components/UserAvatar';
import { clock, displayName } from '../../../lib/format';
import { useDirectory } from '../../../people/useDirectory';
import type {
  ChannelListItem,
  ChannelListItemComment,
  ChannelListItemPriority,
  ChannelListItemStatus,
} from '../../../api/types';
import { dueInputValue } from './ListsWeekView';
import {
  PRIORITIES,
  issueKey,
  normalizeListItem,
  priorityMeta,
} from './listIssueUtils';

const STATUSES: Array<{ id: ChannelListItemStatus; label: string }> = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];

type Props = {
  conversationId: string;
  listId: string;
  listName: string;
  item: ChannelListItem;
  allItems: ChannelListItem[];
  memberIds: string[];
  onClose: () => void;
  onUpdated: (item: ChannelListItem) => void;
  onOpenItem: (itemId: string) => void;
  onCreatedSubtask: (item: ChannelListItem) => void;
  onDeleted: (itemId: string) => void;
};

export function ListIssueDrawer({
  conversationId,
  listId,
  listName,
  item: rawItem,
  allItems,
  memberIds,
  onClose,
  onUpdated,
  onOpenItem,
  onCreatedSubtask,
  onDeleted,
}: Props) {
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const { byUserId, ensureProfiles } = useDirectory();
  const labelsKey = (rawItem.labels ?? []).join('\u0001');
  const item = useMemo(
    () => normalizeListItem(rawItem),
    [
      rawItem.id,
      rawItem.title,
      rawItem.description,
      rawItem.status,
      rawItem.priority,
      rawItem.assigneeId,
      rawItem.dueAt,
      rawItem.estimate,
      rawItem.parentItemId,
      rawItem.jiraKey,
      rawItem.jiraUrl,
      rawItem.updatedAt,
      rawItem.createdAt,
      rawItem.listId,
      rawItem.sortOrder,
      labelsKey,
    ],
  );

  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [status, setStatus] = useState(item.status);
  const [priority, setPriority] = useState<ChannelListItemPriority>(
    item.priority ?? 'medium',
  );
  const [assigneeId, setAssigneeId] = useState(item.assigneeId ?? '');
  const [dueAt, setDueAt] = useState(dueInputValue(item.dueAt));
  const [estimate, setEstimate] = useState(
    item.estimate === null || item.estimate === undefined
      ? ''
      : String(item.estimate),
  );
  const [labelsText, setLabelsText] = useState((item.labels ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [comments, setComments] = useState<ChannelListItemComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [subtaskTitle, setSubtaskTitle] = useState('');

  const key = issueKey(listName, item, allItems);
  const subtasks = useMemo(
    () => allItems.filter((row) => row.parentItemId === item.id),
    [allItems, item.id],
  );
  const parent = item.parentItemId
    ? allItems.find((row) => row.id === item.parentItemId)
    : null;

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description ?? '');
    setStatus(item.status);
    setPriority(item.priority ?? 'medium');
    setAssigneeId(item.assigneeId ?? '');
    setDueAt(dueInputValue(item.dueAt));
    setEstimate(
      item.estimate === null || item.estimate === undefined
        ? ''
        : String(item.estimate),
    );
    setLabelsText((item.labels ?? []).join(', '));
  }, [
    item.id,
    item.title,
    item.description,
    item.status,
    item.priority,
    item.assigneeId,
    item.dueAt,
    item.estimate,
    labelsKey,
  ]);

  useEffect(() => {
    let active = true;
    api<ChannelListItemComment[]>(
      `/chat/conversations/${conversationId}/lists/${listId}/items/${item.id}/comments`,
    )
      .then((response) => {
        if (!active) return;
        const next = Array.isArray(response.data) ? response.data : [];
        setComments(next);
        void ensureProfiles(next.map((row) => row.authorId));
      })
      .catch(() => {
        if (active) setComments([]);
      });
    return () => {
      active = false;
    };
  }, [conversationId, ensureProfiles, item.id, listId]);

  async function savePatch(patch: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const response = await api<ChannelListItem>(
        `/chat/conversations/${conversationId}/lists/${listId}/items/${item.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
      onUpdated(normalizeListItem(response.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update issue');
    } finally {
      setBusy(false);
    }
  }

  async function saveAll(event: FormEvent) {
    event.preventDefault();
    const labels = labelsText
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)
      .slice(0, 12);
    await savePatch({
      title: title.trim() || item.title,
      description,
      status,
      priority,
      assigneeId: assigneeId || null,
      dueAt: dueAt || null,
      estimate: estimate === '' ? null : Number(estimate),
      labels,
    });
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      const response = await api<ChannelListItemComment>(
        `/chat/conversations/${conversationId}/lists/${listId}/items/${item.id}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ body }),
        },
      );
      setComments((current) => [...current, response.data]);
      setCommentDraft('');
      void ensureProfiles([response.data.authorId]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add comment');
    } finally {
      setBusy(false);
    }
  }

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    const nextTitle = subtaskTitle.trim();
    if (!nextTitle) return;
    setBusy(true);
    setError('');
    try {
      const response = await api<ChannelListItem>(
        `/chat/conversations/${conversationId}/lists/${listId}/items`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: nextTitle,
            parentItemId: item.id,
            status: 'todo',
            priority: 'medium',
          }),
        },
      );
      onCreatedSubtask(normalizeListItem(response.data));
      setSubtaskTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create subtask');
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    try {
      await api(
        `/chat/conversations/${conversationId}/lists/${listId}/items/${item.id}/comments/${commentId}`,
        { method: 'DELETE' },
      );
      setComments((current) => current.filter((row) => row.id !== commentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete comment');
    }
  }

  async function pushToJira() {
    setJiraBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api<{
        externalId: string;
        externalUrl: string;
        alreadyLinked?: boolean;
        item?: ChannelListItem;
      }>(`/chat/conversations/${conversationId}/apps/jira/issues`, {
        method: 'POST',
        body: JSON.stringify({
          listId,
          itemId: item.id,
          title: title.trim() || item.title,
          body: description.trim() || undefined,
        }),
      });
      if (response.data.item) {
        onUpdated(normalizeListItem(response.data.item));
      } else {
        onUpdated(
          normalizeListItem({
            ...item,
            jiraKey: response.data.externalId,
            jiraUrl: response.data.externalUrl,
          }),
        );
      }
      setNotice(
        response.data.alreadyLinked
          ? `Already linked as ${response.data.externalId}`
          : `Pushed to Jira as ${response.data.externalId}`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not push to Jira. Connect Jira in Apps and set a default project.',
      );
    } finally {
      setJiraBusy(false);
    }
  }

  const meta = priorityMeta(priority);

  return (
    <aside className="list-issue-drawer" aria-label={`Issue ${key}`}>
      <header className="list-issue-drawer-head">
        <div>
          <p className="list-issue-key">{key}</p>
          <h3>{item.title}</h3>
        </div>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      {parent ? (
        <p className="muted list-issue-parent">
          Subtask of{' '}
          <button
            type="button"
            className="ghost list-issue-parent-link"
            onClick={() => onOpenItem(parent.id)}
          >
            <strong>{issueKey(listName, parent, allItems)}</strong> · {parent.title}
          </button>
        </p>
      ) : null}

      <form className="list-issue-form" onSubmit={(event) => void saveAll(event)}>
        <label>
          <span>Summary</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={500}
            required
          />
        </label>

        <label>
          <span>Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            maxLength={8000}
            placeholder="Acceptance criteria, notes, links…"
          />
        </label>

        <div className="list-issue-grid">
          <label>
            <span>Status</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as ChannelListItemStatus)
              }
            >
              {STATUSES.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as ChannelListItemPriority)
              }
            >
              {PRIORITIES.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.short} {row.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Assignee</span>
            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {me ? <option value={me}>You</option> : null}
              {memberIds
                .filter((id) => id !== me)
                .map((id) => (
                  <option key={id} value={id}>
                    {displayName(byUserId.get(id))}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Due date</span>
            <input
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
          <label>
            <span>Story points</span>
            <input
              type="number"
              min={0}
              max={999}
              value={estimate}
              onChange={(event) => setEstimate(event.target.value)}
              placeholder="e.g. 3"
            />
          </label>
          <label className="list-issue-labels">
            <span>Labels</span>
            <input
              value={labelsText}
              onChange={(event) => setLabelsText(event.target.value)}
              placeholder="api, auth, backend"
            />
          </label>
        </div>

        <div className="list-issue-form-actions">
          <button className="btn" type="submit" disabled={busy || jiraBusy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {item.jiraUrl ? (
            <a
              className="btn ghost list-jira-link"
              href={item.jiraUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open {item.jiraKey || 'Jira'}
            </a>
          ) : (
            <button
              className="btn ghost"
              type="button"
              disabled={busy || jiraBusy}
              onClick={() => void pushToJira()}
            >
              {jiraBusy ? 'Pushing…' : 'Push to Jira'}
            </button>
          )}
          <button
            className="ghost danger-link"
            type="button"
            disabled={busy || jiraBusy}
            onClick={() => onDeleted(item.id)}
          >
            Delete issue
          </button>
        </div>
        {notice ? (
          <p className="muted tab-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </form>

      <section className="list-issue-section">
        <h4>Subtasks ({subtasks.length})</h4>
        <ul className="list-issue-subtasks">
          {subtasks.map((row) => (
            <li key={row.id}>
              <span className={`list-priority-dot priority-${row.priority ?? 'medium'}`} />
              <button
                type="button"
                className="ghost list-issue-subtask-open"
                onClick={() => onOpenItem(row.id)}
              >
                {row.title}
              </button>
              <small className="muted">{row.status}</small>
            </li>
          ))}
        </ul>
        <form
          className="list-issue-inline-form"
          onSubmit={(event) => void addSubtask(event)}
        >
          <input
            value={subtaskTitle}
            onChange={(event) => setSubtaskTitle(event.target.value)}
            placeholder="Add subtask…"
            maxLength={500}
          />
          <button className="ghost" type="submit" disabled={!subtaskTitle.trim() || busy}>
            Add
          </button>
        </form>
      </section>

      <section className="list-issue-section">
        <h4>Activity ({comments.length})</h4>
        <ul className="list-issue-comments">
          {comments.map((comment) => {
            const author = displayName(byUserId.get(comment.authorId));
            return (
              <li key={comment.id}>
                <UserAvatar
                  profile={byUserId.get(comment.authorId)}
                  name={author}
                  size="sm"
                />
                <div>
                  <strong>{author}</strong>
                  <small className="muted">{clock(comment.createdAt)}</small>
                  <p>{comment.body}</p>
                </div>
                {comment.authorId === me ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void removeComment(comment.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <form
          className="list-issue-inline-form"
          onSubmit={(event) => void addComment(event)}
        >
          <input
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            placeholder="Add a comment…"
            maxLength={4000}
          />
          <button className="btn" type="submit" disabled={!commentDraft.trim() || busy}>
            Comment
          </button>
        </form>
      </section>

      <p className="muted list-issue-meta-foot">
        Priority {meta.label} · Updated {item.updatedAt ? clock(item.updatedAt) : '—'}
      </p>
    </aside>
  );
}
