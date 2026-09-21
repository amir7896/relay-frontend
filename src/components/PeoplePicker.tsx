import { useMemo, useState } from 'react';
import { displayName, initials } from '../lib/format';
import type { UserProfile } from '../api/types';

export function PeoplePicker({
  people,
  selected,
  onToggle,
  onPick,
  exclude = [],
  mode = 'multi',
  emptyHint,
}: {
  people: UserProfile[];
  selected?: string[];
  onToggle?: (userId: string) => void;
  onPick?: (person: UserProfile) => void;
  exclude?: string[];
  mode?: 'single' | 'multi';
  emptyHint?: string;
}) {
  const [term, setTerm] = useState('');
  const selectedSet = useMemo(() => new Set(selected ?? []), [selected]);
  const excluded = useMemo(() => new Set(exclude), [exclude]);

  const visible = useMemo(() => {
    const query = term.trim().toLowerCase();
    return people.filter((person) => {
      if (excluded.has(person.userId)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return `${person.firstName} ${person.lastName} ${person.email}`
        .toLowerCase()
        .includes(query);
    });
  }, [people, excluded, term]);

  return (
    <div className="people-picker">
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search name or email"
      />
      <div className="people-list">
        {visible.map((person) => {
          const name = displayName(person);
          const checked = selectedSet.has(person.userId);
          return (
            <button
              key={person.userId}
              className={checked ? 'people-row selected' : 'people-row'}
              type="button"
              onClick={() => {
                if (mode === 'single') {
                  onPick?.(person);
                  return;
                }
                onToggle?.(person.userId);
              }}
            >
              <span className="avatar sm">{initials(name)}</span>
              <span className="people-row-body">
                <strong>{name}</strong>
                <small>{person.email}</small>
              </span>
              {mode === 'multi' ? (
                <span className={checked ? 'pick-mark on' : 'pick-mark'} />
              ) : null}
            </button>
          );
        })}
        {visible.length === 0 ? (
          <p className="muted empty">
            {emptyHint ||
              (people.length === 0
                ? 'No other people in this workspace yet. Invite teammates from Profile, or switch to a workspace that has members.'
                : 'No people match that search.')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
