import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { Conversation } from '../api/types';
import { displayName, initials } from '../lib/format';
import { useDirectory } from '../people/useDirectory';
import {
  buildParticipantRows,
  participantStatusLabel,
} from '../calls/callRoster';
import type { CallRosterInfo, VoiceCallInfo } from '../calls/types';

type Props = {
  call: VoiceCallInfo;
  roster: CallRosterInfo | null;
  me?: string;
  open: boolean;
  onClose: () => void;
  onInvite: (userIds: string[]) => Promise<void>;
};

export function CallParticipantsPanel({
  call,
  roster,
  me,
  open,
  onClose,
  onInvite,
}: Props) {
  const { byUserId, ensureProfiles } = useDirectory();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [eligible, setEligible] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () =>
      buildParticipantRows(roster, {
        memberIds: call.memberIds,
        joinedIds: call.joinedIds,
        hostId: roster?.hostId ?? call.hostId,
      }),
    [call, roster],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    void ensureProfiles(rows.map((row) => row.userId));
  }, [ensureProfiles, open, rows]);

  useEffect(() => {
    if (!inviteOpen || call.kind !== 'group') {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await api<Conversation>(
          `/chat/conversations/${call.conversationId}`,
        );
        if (cancelled) {
          return;
        }
        const inCall = new Set(call.joinedIds);
        const ringing = new Set(roster?.ringingIds ?? []);
        const ids = (response.data.members ?? [])
          .map((member) => member.userId)
          .filter((id) => id !== me && !inCall.has(id) && !ringing.has(id));
        setEligible(ids);
        void ensureProfiles(ids);
      } catch {
        setEligible(
          call.memberIds.filter(
            (id) => id !== me && !call.joinedIds.includes(id),
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    call.conversationId,
    call.joinedIds,
    call.kind,
    call.memberIds,
    ensureProfiles,
    inviteOpen,
    me,
    roster?.ringingIds,
  ]);

  if (!open) {
    return null;
  }

  return (
    <div className="call-participants-panel" role="dialog" aria-label="Participants">
      <header className="call-participants-header">
        <strong>Participants</strong>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <ul className="call-participants-list">
        {rows.map((row) => {
          const profile = byUserId.get(row.userId);
          const name =
            row.userId === me
              ? 'You'
              : profile
                ? displayName(profile)
                : row.userId.slice(0, 8);
          const avatar = profile?.avatar?.trim() || '';
          return (
            <li key={row.userId} className={`status-${row.status}`}>
              <span className="call-participant-avatar">
                {avatar ? <img src={avatar} alt="" /> : initials(name)}
              </span>
              <span className="call-participant-meta">
                <strong>
                  {name}
                  {row.isHost ? ' · Host' : ''}
                </strong>
                <small>{participantStatusLabel(row.status)}</small>
              </span>
            </li>
          );
        })}
      </ul>

      {call.kind === 'group' ? (
        <div className="call-participants-invite">
          {!inviteOpen ? (
            <button
              type="button"
              className="primary call-invite-btn"
              onClick={() => setInviteOpen(true)}
            >
              Add people
            </button>
          ) : (
            <>
              <p className="muted">Invite members who aren’t in this call</p>
              <ul className="call-invite-list">
                {eligible.length === 0 ? (
                  <li className="muted">No one left to invite</li>
                ) : (
                  eligible.map((userId) => {
                    const profile = byUserId.get(userId);
                    const name = profile
                      ? displayName(profile)
                      : userId.slice(0, 8);
                    const checked = selected.includes(userId);
                    return (
                      <li key={userId}>
                        <label>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelected((current) =>
                                checked
                                  ? current.filter((id) => id !== userId)
                                  : [...current, userId],
                              )
                            }
                          />
                          <span>{name}</span>
                        </label>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className="call-invite-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setInviteOpen(false);
                    setSelected([]);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || selected.length === 0}
                  onClick={() => {
                    setBusy(true);
                    void onInvite(selected).finally(() => {
                      setBusy(false);
                      setInviteOpen(false);
                      setSelected([]);
                    });
                  }}
                >
                  {busy ? 'Inviting…' : 'Invite'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
