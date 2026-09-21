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
  ChannelListItemStatus,
  Conversation,
} from '../../../api/types';

const STATUSES: Array<{
  id: ChannelListItemStatus;
  label: string;
}> = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];

function normalizeList(list: ChannelList): ChannelList {
  return { ...list, items: list.items ?? [] };
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
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ChannelListItemStatus | null>(
    null,
  );

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

  const progress = useMemo(() => {
    const total = items.length;
    const done = countByStatus(items, 'done');
    return {
      total,
      done,
      todo: countByStatus(items, 'todo'),
      doing: countByStatus(items, 'doing'),
      percent: total ? Math.round((done / total) * 100) : 0,
    };
  }, [items]);

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
    try {
      const response = await api<ChannelListItem>(`${basePath(listId)}/items`, {
        method: 'POST',
        body: JSON.stringify({ title, status: 'todo', assigneeId }),
      });
      if (!response.data?.id) {
        throw new Error('Server did not return the new item');
      }
      setLists((current) =>
        current.map((list) =>
          list.id === listId
            ? { ...list, items: [...(list.items ?? []), response.data] }
            : list,
        ),
      );
      setNewItemTitle('');
      setNotice(
        assigneeId
          ? `Item added · assigned to ${assigneeLabel(assigneeId)}.`
          : 'Item added.',
      );
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
    if (!itemId) return;
    const item = items.find((row) => row.id === itemId);
    if (!item) return;
    await updateItemStatus(item, status);
  }

  return (
    <section className="feature-panel lists-panel">
      <div className="feature-panel-head lists-panel-head">
        <div>
          <h3>Lists</h3>
          <p className="muted lists-panel-sub">
            Drag cards across columns — assign tasks to channel members.
          </p>
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
                  placeholder="Add a task…"
                  aria-label="New item title"
                  maxLength={500}
                />
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
                <button
                  className="btn"
                  type="submit"
                  disabled={!newItemTitle.trim()}
                >
                  Add item
                </button>
              </form>

              <div className="list-board" role="list">
                {STATUSES.map((column) => {
                  const columnItems = items.filter(
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
                          return (
                            <li
                              key={item.id}
                              className={`list-card${
                                draggingId === item.id ? ' dragging' : ''
                              }${isMine ? ' is-mine' : ''}`}
                              draggable
                              onDragStart={(event) =>
                                onCardDragStart(event, item)
                              }
                              onDragEnd={onCardDragEnd}
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
                                <p className="list-card-title">{item.title}</p>
                                <button
                                  className="list-card-delete"
                                  type="button"
                                  aria-label={`Delete ${item.title}`}
                                  title="Delete"
                                  onClick={() => void deleteItem(item.id)}
                                >
                                  ×
                                </button>
                              </div>

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

                              <div className="list-card-move">
                                {STATUSES.filter((s) => s.id !== item.status).map(
                                  (target) => (
                                    <button
                                      key={target.id}
                                      type="button"
                                      className="ghost list-card-move-btn"
                                      onClick={() =>
                                        void updateItemStatus(item, target.id)
                                      }
                                    >
                                      {target.label}
                                    </button>
                                  ),
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      {columnItems.length === 0 ? (
                        <p className="muted list-column-empty">
                          {draggingId ? 'Drop here' : 'No items'}
                        </p>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
