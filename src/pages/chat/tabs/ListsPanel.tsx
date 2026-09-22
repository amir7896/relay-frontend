import {
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { useConfirm } from '../../../components/ConfirmProvider';
import { UserAvatar } from '../../../components/UserAvatar';
import { displayName } from '../../../lib/format';
import { useDirectory } from '../../../people/useDirectory';
import type {
  ChannelList,
  ChannelListItem,
  ChannelListItemPriority,
  ChannelListItemStatus,
  Conversation,
} from '../../../api/types';
import {
  ListsWeekView,
  dueInputValue,
  formatDueLabel,
  isDueOverdue,
  startOfWeek,
  toDateKey,
} from './ListsWeekView';
import { ListIssueDrawer } from './ListIssueDrawer';
import {
  PRIORITIES,
  issueKey,
  normalizeListItem,
  priorityMeta,
} from './listIssueUtils';

const STATUSES: Array<{
  id: ChannelListItemStatus;
  label: string;
}> = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];

type ListViewMode = 'board' | 'week';

function normalizeList(list: ChannelList): ChannelList {
  return {
    ...list,
    items: (list.items ?? []).map(normalizeListItem),
  };
}

function countByStatus(items: ChannelListItem[], status: ChannelListItemStatus) {
  return items.filter((item) => item.status === status).length;
}

function normalizeAssigneeId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function ListsPanel({
  conversationId,
  conversation,
}: {
  conversationId: string;
  conversation: Conversation;
}) {
  const confirmDialog = useConfirm();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const { byUserId, ensureProfiles } = useDirectory();

  const [lists, setLists] = useState<ChannelList[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [newListName, setNewListName] = useState('');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemAssignee, setNewItemAssignee] = useState('');
  const [newItemDue, setNewItemDue] = useState('');
  const [newItemPriority, setNewItemPriority] =
    useState<ChannelListItemPriority>('medium');
  const [filterQuery, setFilterQuery] = useState('');
  const [filterAssignee, setFilterAssignee] = useState<'all' | 'me' | 'unassigned' | string>(
    'all',
  );
  const [filterPriority, setFilterPriority] = useState<
    'all' | ChannelListItemPriority
  >('all');
  const [filterLabel, setFilterLabel] = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ListViewMode>('board');
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date()));
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ChannelListItemStatus | null>(
    null,
  );
  const [dropDayKey, setDropDayKey] = useState<string | null>(null);

  const memberIds = useMemo(
    () =>
      conversation.members
        .map((member) => member.userId)
        .filter(Boolean)
        .sort((a, b) => {
          if (a === me) return -1;
          if (b === me) return 1;
          return displayName(byUserId.get(a)).localeCompare(
            displayName(byUserId.get(b)),
          );
        }),
    [conversation.members, me, byUserId],
  );

  const selected =
    lists.find((list) => list.id === selectedId) ?? lists[0] ?? null;
  const items = selected?.items ?? [];
  const rootItems = useMemo(
    () => items.filter((item) => !item.parentItemId),
    [items],
  );
  const labelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      for (const label of item.labels ?? []) set.add(label);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return rootItems.filter((item) => {
      if (q) {
        const hay = `${item.title} ${item.description ?? ''} ${(item.labels ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterAssignee === 'me' && item.assigneeId !== me) return false;
      if (filterAssignee === 'unassigned' && item.assigneeId) return false;
      if (
        filterAssignee !== 'all' &&
        filterAssignee !== 'me' &&
        filterAssignee !== 'unassigned' &&
        item.assigneeId !== filterAssignee
      ) {
        return false;
      }
      if (filterPriority !== 'all' && (item.priority ?? 'medium') !== filterPriority) {
        return false;
      }
      if (filterLabel && !(item.labels ?? []).includes(filterLabel)) return false;
      return true;
    });
  }, [
    filterAssignee,
    filterLabel,
    filterPriority,
    filterQuery,
    me,
    rootItems,
  ]);

  const selectedIssue = selectedIssueId
    ? items.find((item) => item.id === selectedIssueId) ?? null
    : null;

  const progress = useMemo(() => {
    const total = rootItems.length;
    const done = countByStatus(rootItems, 'done');
    return {
      total,
      done,
      todo: countByStatus(rootItems, 'todo'),
      doing: countByStatus(rootItems, 'doing'),
      percent: total ? Math.round((done / total) * 100) : 0,
    };
  }, [rootItems]);

  async function loadLists(preferId?: string) {
    setBusy(true);
    setError('');
    try {
      const response = await api<ChannelList[]>(
        `/chat/conversations/${conversationId}/lists`,
      );
      const next = (response.data ?? []).map(normalizeList);
      setLists(next);
      setSelectedId((current) => {
        const preferred = preferId || current;
        if (preferred && next.some((list) => list.id === preferred)) {
          return preferred;
        }
        return next[0]?.id || '';
      });
    } catch {
      setError('Lists are not available yet.');
      setLists([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setSelectedId('');
    setRenaming(false);
    setNewItemAssignee('');
    void loadLists();
  }, [conversationId]);

  useEffect(() => {
    if (selected) setRenameValue(selected.name);
    setSelectedIssueId(null);
  }, [selected?.id, selected?.name]);

  useEffect(() => {
    if (!memberIds.length) return;
    void ensureProfiles(memberIds);
  }, [memberIds, ensureProfiles]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function basePath(listId: string) {
    return `/chat/conversations/${conversationId}/lists/${listId}`;
  }

  function assigneeLabel(userId: string | null | undefined) {
    if (!userId) return 'Unassigned';
    if (userId === me) return 'You';
    return displayName(byUserId.get(userId));
  }

  function patchItemLocal(
    listId: string,
    itemId: string,
    patch: Partial<ChannelListItem>,
  ) {
    setLists((current) =>
      current.map((list) =>
        list.id === listId
          ? {
              ...list,
              items: (list.items ?? []).map((row) =>
                row.id === itemId ? { ...row, ...patch } : row,
              ),
            }
          : list,
      ),
    );
  }

  async function createList(event: FormEvent) {
    event.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    setError('');
    try {
      const response = await api<ChannelList>(
        `/chat/conversations/${conversationId}/lists`,
        {
          method: 'POST',
          body: JSON.stringify({ name }),
        },
      );
      const created = normalizeList(response.data);
      setLists((current) => [...current, created]);
      setSelectedId(created.id);
      setRenaming(false);
      setNewListName('');
      setNotice('List created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the list.');
    }
  }

  async function renameList(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const name = renameValue.trim();
    if (!name || name === selected.name) {
      setRenaming(false);
      return;
    }
    setError('');
    try {
      const response = await api<ChannelList>(basePath(selected.id), {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      const listId = selected.id;
      const updated = normalizeList({
        ...response.data,
        id:
          response.data?.id && response.data.id !== 'undefined'
            ? response.data.id
            : listId,
        items: response.data?.items ?? selected.items,
      });
      setLists((current) =>
        current.map((list) => (list.id === listId ? updated : list)),
      );
      setSelectedId(updated.id);
      setRenaming(false);
      setNotice('List renamed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the list.');
    }
  }

  async function deleteList(listId: string) {
    const confirmed = await confirmDialog({
      title: 'Delete list?',
      message:
        'This deletes the list and all of its items for everyone in the channel.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api(basePath(listId), { method: 'DELETE' });
      setLists((current) => {
        const next = current.filter((list) => list.id !== listId);
        setSelectedId(next[0]?.id || '');
        return next;
      });
      setNotice('List deleted.');
    } catch {
      setError('Could not delete the list.');
    }
  }

  async function addItem(event: FormEvent) {
    event.preventDefault();
    const title = newItemTitle.trim();
    const listId = selected?.id;
    if (!listId || !title) return;
    setError('');
    setNotice('');
    const assigneeId = normalizeAssigneeId(newItemAssignee);
    const dueAt = newItemDue.trim() ? newItemDue.trim() : null;
    try {
      const response = await api<ChannelListItem>(`${basePath(listId)}/items`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          status: 'todo',
          assigneeId,
          dueAt,
          priority: newItemPriority,
        }),
      });
      if (!response.data?.id) {
        throw new Error('Server did not return the new item');
      }
      setLists((current) =>
        current.map((list) =>
          list.id === listId
            ? {
                ...list,
                items: [
                  ...(list.items ?? []),
                  normalizeListItem(response.data),
                ],
              }
            : list,
        ),
      );
      setNewItemTitle('');
      setNewItemPriority('medium');
      const bits = [
        assigneeId ? `assigned to ${assigneeLabel(assigneeId)}` : null,
        dueAt ? `due ${formatDueLabel(dueAt)}` : null,
        newItemPriority !== 'medium' ? priorityMeta(newItemPriority).label : null,
      ].filter(Boolean);
      setNotice(bits.length ? `Issue created · ${bits.join(' · ')}.` : 'Issue created.');
      setSelectedIssueId(response.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the item.');
    }
  }

  async function updateItemStatus(
    item: ChannelListItem,
    status: ChannelListItemStatus,
  ) {
    if (!selected || item.status === status) return;
    const listId = selected.id;
    patchItemLocal(listId, item.id, { status });
    try {
      await api(`${basePath(listId)}/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    } catch {
      setError('Could not update the item.');
      void loadLists(listId);
    }
  }

  async function updateItemAssignee(
    item: ChannelListItem,
    assigneeId: string | null,
  ) {
    if (!selected) return;
    if ((item.assigneeId ?? null) === assigneeId) return;
    const listId = selected.id;
    patchItemLocal(listId, item.id, { assigneeId });
    try {
      await api(`${basePath(listId)}/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId }),
      });
      setNotice(
        assigneeId
          ? `Assigned to ${assigneeLabel(assigneeId)}.`
          : 'Assignee cleared.',
      );
    } catch {
      setError('Could not update assignee.');
      void loadLists(listId);
    }
  }

  async function updateItemDue(item: ChannelListItem, dueAt: string | null) {
    if (!selected) return;
    const next = dueAt?.trim() ? dueAt.trim() : null;
    const prevKey = item.dueAt ? toDateKey(item.dueAt) : '';
    const nextKey = next ? toDateKey(next) : '';
    if (prevKey === nextKey && Boolean(item.dueAt) === Boolean(next)) return;
    const listId = selected.id;
    const optimisticDue = next ? `${next}T12:00:00.000Z` : null;
    patchItemLocal(listId, item.id, { dueAt: optimisticDue });
    try {
      const response = await api<ChannelListItem>(
        `${basePath(listId)}/items/${item.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ dueAt: next }),
        },
      );
      if (response.data) {
        patchItemLocal(listId, item.id, { dueAt: response.data.dueAt ?? null });
      }
      setNotice(
        next ? `Due date set to ${formatDueLabel(next)}.` : 'Due date cleared.',
      );
    } catch {
      setError('Could not update due date.');
      void loadLists(listId);
    }
  }

  async function deleteItem(itemId: string) {
    if (!selected) return;
    const listId = selected.id;
    try {
      await api(`${basePath(listId)}/items/${itemId}`, { method: 'DELETE' });
      setLists((current) =>
        current.map((list) =>
          list.id === listId
            ? {
                ...list,
                items: (list.items ?? []).filter((item) => item.id !== itemId),
              }
            : list,
        ),
      );
    } catch {
      setError('Could not delete the item.');
    }
  }

  function onCardDragStart(event: DragEvent, item: ChannelListItem) {
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(item.id);
  }

  function onCardDragEnd() {
    setDraggingId(null);
    setDropTarget(null);
    setDropDayKey(null);
  }

  function onColumnDragOver(event: DragEvent, status: ChannelListItemStatus) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropTarget !== status) setDropTarget(status);
  }

  function onColumnDragLeave(status: ChannelListItemStatus) {
    setDropTarget((current) => (current === status ? null : current));
  }

  async function onColumnDrop(
    event: DragEvent,
    status: ChannelListItemStatus,
  ) {
    event.preventDefault();
    const itemId = event.dataTransfer.getData('text/plain') || draggingId;
    setDropTarget(null);
    setDraggingId(null);
    setDropDayKey(null);
    if (!itemId) return;
    const item = items.find((row) => row.id === itemId);
    if (!item) return;
    await updateItemStatus(item, status);
  }

  function onDayDragOver(event: DragEvent, dayKey: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dropDayKey !== dayKey) setDropDayKey(dayKey);
  }

  function onDayDragLeave(dayKey: string) {
    setDropDayKey((current) => (current === dayKey ? null : current));
  }

  async function onDayDrop(event: DragEvent, dayKey: string | null) {
    event.preventDefault();
    const itemId = event.dataTransfer.getData('text/plain') || draggingId;
    setDropDayKey(null);
    setDraggingId(null);
    if (!itemId) return;
    const item = items.find((row) => row.id === itemId);
    if (!item) return;
    await updateItemDue(item, dayKey);
  }

  return (
    <section className="feature-panel lists-panel">
      <div className="feature-panel-head lists-panel-head">
        <div>
          <h3>Lists</h3>
          <p className="muted lists-panel-sub">
            Jira-style issues — priority, labels, story points, subtasks, and
            comments. Drag cards across the board.
          </p>
        </div>
        <div className="lists-view-toggle" role="tablist" aria-label="List view">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'board'}
            className={viewMode === 'board' ? 'on' : ''}
            onClick={() => setViewMode('board')}
          >
            Board
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'week'}
            className={viewMode === 'week' ? 'on' : ''}
            onClick={() => setViewMode('week')}
          >
            Week
          </button>
        </div>
        {error ? <p className="error tab-notice lists-inline-notice">{error}</p> : null}
        {!error && notice ? (
          <p className="muted tab-notice lists-inline-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="lists-layout">
        <aside className="lists-sidebar">
          <form className="lists-sidebar-create" onSubmit={createList}>
            <input
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="New list name"
              aria-label="New list name"
              maxLength={160}
            />
            <button className="btn" type="submit" disabled={!newListName.trim()}>
              Add
            </button>
          </form>
          {busy ? <p className="muted lists-sidebar-empty">Loading…</p> : null}
          {!busy && lists.length === 0 ? (
            <p className="muted lists-sidebar-empty">No lists yet.</p>
          ) : null}
          <ul className="lists-nav" aria-label="Channel lists">
            {lists.map((list) => {
              const listItems = list.items ?? [];
              const done = countByStatus(listItems, 'done');
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    className={`lists-nav-item${selected?.id === list.id ? ' active' : ''}`}
                    onClick={() => {
                      setSelectedId(list.id);
                      setRenaming(false);
                      setNotice('');
                    }}
                  >
                    <span className="lists-nav-name">{list.name}</span>
                    <span className="lists-nav-meta">
                      {done}/{listItems.length}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="list-detail">
          {!selected ? (
            <p className="muted tab-empty">
              Create a list to start tracking work in this channel.
            </p>
          ) : (
            <>
              <div className="list-detail-head">
                {renaming ? (
                  <form className="list-rename" onSubmit={renameList}>
                    <input
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      aria-label="List name"
                      autoFocus
                      maxLength={160}
                    />
                    <div className="list-rename-actions">
                      <button className="btn" type="submit">
                        Save
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          setRenaming(false);
                          setRenameValue(selected.name);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="list-detail-title">
                    <h4 title={selected.name}>{selected.name}</h4>
                    <div className="list-detail-actions">
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => setRenaming(true)}
                      >
                        Rename
                      </button>
                      <button
                        className="ghost danger-link"
                        type="button"
                        onClick={() => void deleteList(selected.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
                <div className="list-progress" aria-label="List progress">
                  <div className="list-progress-bar">
                    <span style={{ width: `${progress.percent}%` }} />
                  </div>
                  <small className="muted">
                    {progress.done} of {progress.total} done
                    {progress.total ? ` · ${progress.percent}%` : ''}
                  </small>
                </div>
              </div>

              <form className="list-add-item" onSubmit={addItem}>
                <input
                  value={newItemTitle}
                  onChange={(event) => setNewItemTitle(event.target.value)}
                  placeholder="Create issue…"
                  aria-label="New issue summary"
                  maxLength={500}
                />
                <select
                  value={newItemPriority}
                  onChange={(event) =>
                    setNewItemPriority(
                      event.target.value as ChannelListItemPriority,
                    )
                  }
                  aria-label="Priority"
                  className="list-add-priority"
                >
                  {PRIORITIES.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </select>
                <div className="list-add-assignee">
                  <select
                    value={newItemAssignee}
                    onChange={(event) => setNewItemAssignee(event.target.value)}
                    aria-label="Assign to"
                  >
                    <option value="">Unassigned</option>
                    {me ? (
                      <option value={me}>Assign to me</option>
                    ) : null}
                    {memberIds
                      .filter((userId) => userId !== me)
                      .map((userId) => (
                        <option key={userId} value={userId}>
                          {displayName(byUserId.get(userId))}
                        </option>
                      ))}
                  </select>
                  {me ? (
                    <button
                      className="ghost list-assign-me"
                      type="button"
                      title="Assign to me"
                      onClick={() => setNewItemAssignee(me)}
                      disabled={newItemAssignee === me}
                    >
                      Me
                    </button>
                  ) : null}
                </div>
                <input
                  className="list-add-due"
                  type="date"
                  value={newItemDue}
                  onChange={(event) => setNewItemDue(event.target.value)}
                  aria-label="Due date"
                  title="Due date"
                />
                <button
                  className="btn"
                  type="submit"
                  disabled={!newItemTitle.trim()}
                >
                  Create
                </button>
              </form>

              <div className="list-filters" aria-label="Issue filters">
                <input
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                  placeholder="Search issues…"
                  aria-label="Search issues"
                />
                <select
                  value={filterAssignee}
                  onChange={(event) => setFilterAssignee(event.target.value)}
                  aria-label="Filter by assignee"
                >
                  <option value="all">Anyone</option>
                  <option value="me">Assigned to me</option>
                  <option value="unassigned">Unassigned</option>
                  {memberIds
                    .filter((id) => id !== me)
                    .map((id) => (
                      <option key={id} value={id}>
                        {displayName(byUserId.get(id))}
                      </option>
                    ))}
                </select>
                <select
                  value={filterPriority}
                  onChange={(event) =>
                    setFilterPriority(
                      event.target.value as 'all' | ChannelListItemPriority,
                    )
                  }
                  aria-label="Filter by priority"
                >
                  <option value="all">Any priority</option>
                  {PRIORITIES.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </select>
                <select
                  value={filterLabel}
                  onChange={(event) => setFilterLabel(event.target.value)}
                  aria-label="Filter by label"
                >
                  <option value="">Any label</option>
                  {labelOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div
                className={`list-workspace${selectedIssue ? ' with-drawer' : ''}`}
              >
              {viewMode === 'week' ? (
                <ListsWeekView
                  items={filteredItems}
                  weekAnchor={weekAnchor}
                  onWeekAnchorChange={setWeekAnchor}
                  draggingId={draggingId}
                  dropDayKey={dropDayKey}
                  selectedIssueId={selectedIssueId}
                  onSelectIssue={setSelectedIssueId}
                  onDragStart={onCardDragStart}
                  onDragEnd={onCardDragEnd}
                  onDayDragOver={onDayDragOver}
                  onDayDragLeave={onDayDragLeave}
                  onDayDrop={onDayDrop}
                />
              ) : (
              <div className="list-board" role="list">
                {STATUSES.map((column) => {
                  const columnItems = filteredItems.filter(
                    (item) => item.status === column.id,
                  );
                  const isDropTarget = dropTarget === column.id;
                  return (
                    <section
                      key={column.id}
                      className={`list-column list-column-${column.id}${
                        isDropTarget ? ' drop-target' : ''
                      }${draggingId ? ' is-dragging' : ''}`}
                      aria-label={column.label}
                      onDragOver={(event) => onColumnDragOver(event, column.id)}
                      onDragLeave={() => onColumnDragLeave(column.id)}
                      onDrop={(event) => void onColumnDrop(event, column.id)}
                    >
                      <header className="list-column-head">
                        <strong>{column.label}</strong>
                        <span className="list-column-count">
                          {columnItems.length}
                        </span>
                      </header>
                      <ul className="list-column-items">
                        {columnItems.map((item) => {
                          const assigneeProfile = item.assigneeId
                            ? byUserId.get(item.assigneeId)
                            : null;
                          const isMine = Boolean(me && item.assigneeId === me);
                          const meta = priorityMeta(item.priority);
                          const key = selected
                            ? issueKey(selected.name, item, items)
                            : item.id.slice(0, 8);
                          const childCount = items.filter(
                            (row) => row.parentItemId === item.id,
                          ).length;
                          return (
                            <li
                              key={item.id}
                              className={`list-card priority-${item.priority ?? 'medium'}${
                                draggingId === item.id ? ' dragging' : ''
                              }${isMine ? ' is-mine' : ''}${
                                selectedIssueId === item.id ? ' is-selected' : ''
                              }`}
                              draggable
                              onDragStart={(event) =>
                                onCardDragStart(event, item)
                              }
                              onDragEnd={onCardDragEnd}
                              onClick={() => setSelectedIssueId(item.id)}
                            >
                              <div className="list-card-top">
                                <span
                                  className="list-card-grip"
                                  aria-hidden="true"
                                  title="Drag to another column"
                                >
                                  <svg
                                    viewBox="0 0 16 16"
                                    width="14"
                                    height="14"
                                  >
                                    <circle cx="5" cy="4" r="1.2" fill="currentColor" />
                                    <circle cx="11" cy="4" r="1.2" fill="currentColor" />
                                    <circle cx="5" cy="8" r="1.2" fill="currentColor" />
                                    <circle cx="11" cy="8" r="1.2" fill="currentColor" />
                                    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
                                    <circle cx="11" cy="12" r="1.2" fill="currentColor" />
                                  </svg>
                                </span>
                                <div className="list-card-main">
                                  <span className="list-card-key">{key}</span>
                                  <p className="list-card-title">{item.title}</p>
                                  {item.jiraKey ? (
                                    <a
                                      className="list-card-jira"
                                      href={item.jiraUrl || undefined}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(event) => event.stopPropagation()}
                                      title="Open in Jira"
                                    >
                                      {item.jiraKey}
                                    </a>
                                  ) : null}
                                </div>
                                <button
                                  className="list-card-delete"
                                  type="button"
                                  aria-label={`Delete ${item.title}`}
                                  title="Delete"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void deleteItem(item.id);
                                  }}
                                >
                                  ×
                                </button>
                              </div>

                              <div className="list-card-meta-row">
                                <span
                                  className={`list-priority-badge priority-${item.priority ?? 'medium'}`}
                                  title={meta.label}
                                >
                                  {meta.short} {meta.label}
                                </span>
                                {typeof item.estimate === 'number' ? (
                                  <span className="list-estimate-chip">
                                    {item.estimate} pts
                                  </span>
                                ) : null}
                                {childCount > 0 ? (
                                  <span className="list-subtask-chip">
                                    {childCount} sub
                                  </span>
                                ) : null}
                              </div>

                              {(item.labels ?? []).length > 0 ? (
                                <div className="list-card-labels">
                                  {(item.labels ?? []).slice(0, 4).map((label) => (
                                    <span key={label} className="list-label-chip">
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              <div className="list-card-assignee">
                                {item.assigneeId ? (
                                  <UserAvatar
                                    profile={assigneeProfile}
                                    name={assigneeLabel(item.assigneeId)}
                                    size="sm"
                                    className="list-card-avatar"
                                  />
                                ) : (
                                  <span
                                    className="list-card-avatar-empty"
                                    aria-hidden="true"
                                  />
                                )}
                                <select
                                  className="list-card-assignee-select"
                                  value={item.assigneeId ?? ''}
                                  aria-label={`Assignee for ${item.title}`}
                                  onClick={(event) => event.stopPropagation()}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    event.stopPropagation();
                                    void updateItemAssignee(
                                      item,
                                      normalizeAssigneeId(event.target.value),
                                    );
                                  }}
                                >
                                  <option value="">Unassigned</option>
                                  {me ? (
                                    <option value={me}>You</option>
                                  ) : null}
                                  {memberIds
                                    .filter((userId) => userId !== me)
                                    .map((userId) => (
                                      <option key={userId} value={userId}>
                                        {displayName(byUserId.get(userId))}
                                      </option>
                                    ))}
                                </select>
                                {me && item.assigneeId !== me ? (
                                  <button
                                    type="button"
                                    className="ghost list-card-take"
                                    title="Assign to me"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void updateItemAssignee(item, me);
                                    }}
                                  >
                                    Take
                                  </button>
                                ) : null}
                              </div>

                              <div className="list-card-due">
                                <input
                                  type="date"
                                  className="list-card-due-input"
                                  value={dueInputValue(item.dueAt)}
                                  aria-label={`Due date for ${item.title}`}
                                  onClick={(event) => event.stopPropagation()}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    event.stopPropagation();
                                    void updateItemDue(
                                      item,
                                      event.target.value || null,
                                    );
                                  }}
                                />
                                {item.dueAt ? (
                                  <span
                                    className={`list-card-due-label${
                                      isDueOverdue(item.dueAt, item.status)
                                        ? ' is-overdue'
                                        : ''
                                    }`}
                                  >
                                    {formatDueLabel(item.dueAt)}
                                  </span>
                                ) : (
                                  <span className="list-card-due-label muted">
                                    No due date
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      {columnItems.length === 0 ? (
                        <p className="muted list-column-empty">
                          {draggingId ? 'Drop here' : 'No issues'}
                        </p>
                      ) : null}
                    </section>
                  );
                })}
              </div>
              )}

              {selected && selectedIssue ? (
                <ListIssueDrawer
                  conversationId={conversationId}
                  listId={selected.id}
                  listName={selected.name}
                  item={selectedIssue}
                  allItems={items}
                  memberIds={memberIds}
                  onClose={() => setSelectedIssueId(null)}
                  onUpdated={(next) => {
                    patchItemLocal(selected.id, next.id, next);
                  }}
                  onOpenItem={setSelectedIssueId}
                  onCreatedSubtask={(next) => {
                    setLists((current) =>
                      current.map((list) =>
                        list.id === selected.id
                          ? {
                              ...list,
                              items: [...(list.items ?? []), next],
                            }
                          : list,
                      ),
                    );
                  }}
                  onDeleted={(itemId) => {
                    void deleteItem(itemId);
                    setSelectedIssueId(null);
                  }}
                />
              ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
