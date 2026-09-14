import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useConfirm } from '../../components/ConfirmProvider';
import { PeoplePicker } from '../../components/PeoplePicker';
import { UserAvatar } from '../../components/UserAvatar';
import {
  conversationTitle,
  displayName,
  formatLastSeen,
  otherMember,
} from '../../lib/format';
import { useDirectory } from '../../people/useDirectory';
import type { Conversation } from '../../api/types';
import type { MessengerOutletContext } from './MessengerPage';

const DISAPPEARING_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 3600, label: '1 hour' },
  { value: 86_400, label: '24 hours' },
  { value: 604_800, label: '7 days' },
  { value: 7_776_000, label: '90 days' },
];

function disappearingLabel(seconds: number | undefined) {
  const match = DISAPPEARING_OPTIONS.find((item) => item.value === (seconds ?? 0));
  return match?.label ?? 'Off';
}

export function ConversationDetailsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const me = session?.user.id;
  const confirmDialog = useConfirm();
  const { refreshInbox } = useOutletContext<MessengerOutletContext>();
  const { people, byUserId, ensureProfiles } = useDirectory();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [summary, setSummary] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api<Conversation>(`/chat/conversations/${id}`);
      const next = response.data;
      setConversation(next);
      setNameDraft(next.name ?? '');
      await ensureProfiles(next.members.map((member) => member.userId));
    } catch (err) {
      setConversation(null);
      setError(err instanceof Error ? err.message : 'Could not load details');
    } finally {
      setLoading(false);
    }
  }, [ensureProfiles, id]);

  useEffect(() => {
    setSummary('');
    setActionError('');
    void load();
  }, [load]);

  const peer = conversation ? otherMember(conversation, me) : undefined;
  const myRole = conversation?.members.find((member) => member.userId === me)?.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const isCreator = Boolean(me && conversation?.createdBy === me);
  const memberIds = useMemo(
    () => conversation?.members.map((member) => member.userId) ?? [],
    [conversation],
  );

  const title = conversation
    ? conversationTitle(conversation, me, byUserId)
    : 'Details';
  const pageTitle =
    conversation?.type === 'group' ? 'Channel details' : 'Chat info';

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = nameDraft.trim();
    if (!name) {
      return;
    }
    try {
      const response = await api<Conversation>(`/chat/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setConversation(response.data);
      setNameDraft(response.data.name ?? '');
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not rename channel');
    }
  }

  async function addMember(userId: string) {
    try {
      await api(`/chat/conversations/${id}/members`, {
        method: 'POST',
        body: JSON.stringify({ memberIds: [userId] }),
      });
      await load();
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not add that person');
    }
  }

  async function removeMember(userId: string) {
    try {
      await api(`/chat/conversations/${id}/members/${userId}`, { method: 'DELETE' });
      await load();
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove that person');
    }
  }

  async function setMemberRole(userId: string, role: 'admin' | 'member') {
    try {
      const response = await api<Conversation>(
        `/chat/conversations/${id}/members/${userId}/role`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        },
      );
      setConversation(response.data);
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update role');
    }
  }

  async function toggleMute() {
    if (!conversation) {
      return;
    }
    try {
      const response = await api<Conversation>(`/chat/conversations/${id}/mute`, {
        method: 'POST',
        body: JSON.stringify({ muted: !conversation.muted }),
      });
      setConversation(response.data);
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update mute');
    }
  }

  async function togglePin() {
    if (!conversation) {
      return;
    }
    try {
      const response = await api<Conversation>(`/chat/conversations/${id}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned: !conversation.pinned }),
      });
      setConversation({
        ...response.data,
        pinned: Boolean(response.data.pinned),
      });
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update pin');
    }
  }

  async function setDisappearing(durationSeconds: number) {
    if (!conversation) {
      return;
    }
    try {
      const response = await api<Conversation>(
        `/chat/conversations/${id}/disappearing`,
        {
          method: 'POST',
          body: JSON.stringify({ durationSeconds }),
        },
      );
      setConversation({
        ...response.data,
        muted: Boolean(response.data.muted),
        pinned: Boolean(response.data.pinned),
        disappearingDurationSeconds:
          response.data.disappearingDurationSeconds ?? 0,
      });
      void refreshInbox();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not update disappearing messages',
      );
    }
  }

  async function summarizeThread() {
    setSummaryBusy(true);
    setActionError('');
    try {
      const response = await api<{ summary: string; poweredByAi: boolean }>(
        `/chat/conversations/${id}/summarize`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setSummary(response.data.summary);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not summarize thread');
    } finally {
      setSummaryBusy(false);
    }
  }

  async function blockPeer() {
    if (!peer) {
      return;
    }
    const ok = await confirmDialog({
      title: 'Block user',
      message: 'Block this user? They will not be able to message you.',
      confirmLabel: 'Block',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) {
      return;
    }
    try {
      await api('/chat/blocks', {
        method: 'POST',
        body: JSON.stringify({ userId: peer.userId }),
      });
      setConversation((current) =>
        current
          ? { ...current, blockedByMe: true, blockedMe: Boolean(current.blockedMe) }
          : current,
      );
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not block user');
    }
  }

  async function unblockPeer() {
    if (!peer) {
      return;
    }
    const label = displayName(byUserId.get(peer.userId));
    const ok = await confirmDialog({
      title: 'Unblock user',
      message: `Unblock ${label}? They will be able to message you again.`,
      confirmLabel: 'Unblock',
      cancelLabel: 'Cancel',
    });
    if (!ok) {
      return;
    }
    try {
      await api(`/chat/blocks/${peer.userId}`, { method: 'DELETE' });
      setConversation((current) =>
        current ? { ...current, blockedByMe: false } : current,
      );
      void refreshInbox();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not unblock user');
    }
  }

  async function leave() {
    try {
      await api(`/chat/conversations/${id}/leave`, { method: 'POST' });
      void refreshInbox();
      navigate('/chat');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not leave the channel');
    }
  }

  async function deleteGroup() {
    const ok = await confirmDialog({
      title: 'Delete channel',
      message: 'Delete this channel for everyone? This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) {
      return;
    }
    try {
      await api(`/chat/conversations/${id}`, { method: 'DELETE' });
      void refreshInbox();
      navigate('/chat');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete the channel');
    }
  }

  return (
    <section className="thread conversation-details-page">
      <header className="thread-head conversation-details-head">
        <button
          className="ghost thread-tool-btn thread-back"
          type="button"
          aria-label="Back to conversation"
          title="Back"
          onClick={() => navigate(`/chat/${id}`)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"
            />
          </svg>
        </button>
        <div className="conversation-details-title">
          <p className="muted conversation-details-eyebrow">{pageTitle}</p>
          <h2>{loading ? 'Loading…' : title}</h2>
        </div>
        {conversation ? (
          <UserAvatar
            profile={
              conversation.type === 'private'
                ? byUserId.get(peer?.userId ?? '')
                : null
            }
            name={title}
            size="md"
          />
        ) : null}
      </header>

      <div className="conversation-details-body">
        {error ? <p className="error">{error}</p> : null}
        {actionError ? <p className="error">{actionError}</p> : null}

        {loading && !conversation ? (
          <p className="muted pad">Loading details…</p>
        ) : null}

        {conversation?.type === 'private' ? (
          <div className="conversation-details-grid conversation-details-grid--dm">
            <section className="conversation-details-section conversation-details-col">
              <h3>About</h3>
              <div className="conversation-details-about">
                <UserAvatar
                  profile={byUserId.get(peer?.userId ?? '')}
                  name={title}
                  size="lg"
                />
                <div>
                  <strong>{title}</strong>
                  <p className="muted modal-lead" style={{ margin: '6px 0 0' }}>
                    {peer
                      ? formatLastSeen(peer.lastSeenAt, peer.status)
                      : 'Direct message'}
                  </p>
                </div>
              </div>
              <dl className="conversation-details-meta">
                <div>
                  <dt>Members</dt>
                  <dd>2</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>
                    {new Date(conversation.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {[
                      conversation.pinned ? 'Pinned' : null,
                      conversation.muted ? 'Muted' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Active'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="conversation-details-section conversation-details-col">
              <h3>Settings</h3>
              <div className="modal-actions">
                <button className="ghost full" type="button" onClick={() => void togglePin()}>
                  {conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
                </button>
                <button className="ghost full" type="button" onClick={() => void toggleMute()}>
                  {conversation.muted ? 'Unmute conversation' : 'Mute conversation'}
                </button>
                <label className="disappearing-field">
                  <span>Disappearing messages</span>
                  <select
                    value={conversation.disappearingDurationSeconds ?? 0}
                    onChange={(event) =>
                      void setDisappearing(Number(event.target.value))
                    }
                  >
                    {DISAPPEARING_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Link className="ghost full details-link-btn" to={`/chat/${id}?media=all`}>
                  Media (photos, files, voice)
                </Link>
                <button
                  className="ghost full"
                  type="button"
                  disabled={summaryBusy}
                  onClick={() => void summarizeThread()}
                >
                  {summaryBusy ? 'Summarizing…' : 'Summarize thread (AI)'}
                </button>
              </div>
              {summary ? <pre className="thread-summary">{summary}</pre> : null}
            </section>

            <section className="conversation-details-section conversation-details-col">
              <h3>Privacy</h3>
              <div className="modal-actions">
                {conversation.blockedByMe ? (
                  <button className="btn full" type="button" onClick={() => void unblockPeer()}>
                    Unblock user
                  </button>
                ) : (
                  <button className="danger full" type="button" onClick={() => void blockPeer()}>
                    Block user
                  </button>
                )}
                <Link className="ghost full details-link-btn" to="/blocked">
                  Manage blocked users
                </Link>
              </div>
            </section>
          </div>
        ) : null}

        {conversation?.type === 'group' ? (
          <div className="conversation-details-grid">
            <section className="conversation-details-section conversation-details-col">
              <h3>Members · {conversation.members.length}</h3>
              <ul className="member-list">
                {conversation.members.map((member) => {
                  const name = displayName(byUserId.get(member.userId));
                  const canRemove =
                    canManage && member.userId !== me && member.role !== 'owner';
                  const canChangeRole =
                    isOwner && member.userId !== me && member.role !== 'owner';
                  return (
                    <li key={member.userId}>
                      <span className="member-identity">
                        <span className={member.status === 'online' ? 'dot on' : 'dot'} />
                        <span>
                          {name}
                          {member.userId === me ? ' (you)' : ''}
                          <small> · {member.role}</small>
                          <small className="member-last-seen">
                            {' '}
                            · {formatLastSeen(member.lastSeenAt, member.status)}
                          </small>
                        </span>
                      </span>
                      <span className="member-actions">
                        {canChangeRole ? (
                          member.role === 'admin' ? (
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => void setMemberRole(member.userId, 'member')}
                            >
                              Demote to member
                            </button>
                          ) : (
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => void setMemberRole(member.userId, 'admin')}
                            >
                              Promote to admin
                            </button>
                          )
                        ) : null}
                        {canRemove ? (
                          <button
                            className="danger-text"
                            type="button"
                            onClick={() => void removeMember(member.userId)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="conversation-details-section conversation-details-col">
              <h3>Settings</h3>
              <dl className="conversation-details-meta">
                <div>
                  <dt>Online</dt>
                  <dd>
                    {conversation.members.filter((m) => m.status === 'online').length} /{' '}
                    {conversation.members.length}
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    {new Date(conversation.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </dd>
                </div>
                <div>
                  <dt>Disappearing</dt>
                  <dd>{disappearingLabel(conversation.disappearingDurationSeconds)}</dd>
                </div>
              </dl>
              <div className="modal-actions">
                <button className="ghost full" type="button" onClick={() => void togglePin()}>
                  {conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
                </button>
                <button className="ghost full" type="button" onClick={() => void toggleMute()}>
                  {conversation.muted ? 'Unmute conversation' : 'Mute conversation'}
                </button>
                {canManage ? (
                  <label className="disappearing-field">
                    <span>Disappearing messages</span>
                    <select
                      value={conversation.disappearingDurationSeconds ?? 0}
                      onChange={(event) =>
                        void setDisappearing(Number(event.target.value))
                      }
                    >
                      {DISAPPEARING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <Link className="ghost full details-link-btn" to={`/chat/${id}?media=all`}>
                  Media (photos, files, voice)
                </Link>
                <button
                  className="ghost full"
                  type="button"
                  disabled={summaryBusy}
                  onClick={() => void summarizeThread()}
                >
                  {summaryBusy ? 'Summarizing…' : 'Summarize thread (AI)'}
                </button>
              </div>
              {summary ? <pre className="thread-summary">{summary}</pre> : null}
            </section>

            <section className="conversation-details-section conversation-details-col">
              <h3>Manage</h3>
              {canManage ? (
                <>
                  <form className="modal-form" onSubmit={(event) => void rename(event)}>
                    <label>
                      Channel name
                      <input
                        name="name"
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        required
                      />
                    </label>
                    <button className="btn full" type="submit">
                      Save name
                    </button>
                  </form>
                  <div className="add-people">
                    <p className="muted">Add people</p>
                    <PeoplePicker
                      people={people}
                      mode="single"
                      exclude={memberIds}
                      onPick={(person) => void addMember(person.userId)}
                    />
                  </div>
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Only channel owners and admins can rename this channel or add people.
                </p>
              )}
              <div className="modal-actions conversation-details-danger">
                <button className="danger full" type="button" onClick={() => void leave()}>
                  Leave channel
                </button>
                {isCreator ? (
                  <button
                    className="danger full"
                    type="button"
                    onClick={() => void deleteGroup()}
                  >
                    Delete channel
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
