import { DragEvent } from 'react';
import type { ChannelListItem } from '../../../api/types';

export function toDateKey(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday-start week containing `anchor`. */
export function startOfWeek(anchor: Date): Date {
  const date = new Date(anchor);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

export function addDays(anchor: Date, days: number): Date {
  const date = new Date(anchor);
  date.setDate(date.getDate() + days);
  return date;
}

export function dueInputValue(dueAt: string | null | undefined): string {
  if (!dueAt) return '';
  return toDateKey(dueAt);
}

export function formatDueLabel(dueAt: string | null | undefined): string {
  if (!dueAt) return '';
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return '';
  const todayKey = toDateKey(new Date());
  const key = toDateKey(date);
  if (key === todayKey) return 'Today';
  if (key === toDateKey(addDays(new Date(), 1))) return 'Tomorrow';
  if (key === toDateKey(addDays(new Date(), -1))) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function isDueOverdue(dueAt: string | null | undefined, status: string): boolean {
  if (!dueAt || status === 'done') return false;
  const key = toDateKey(dueAt);
  return Boolean(key && key < toDateKey(new Date()));
}

type ListsWeekViewProps = {
  items: ChannelListItem[];
  weekAnchor: Date;
  onWeekAnchorChange: (next: Date) => void;
  draggingId: string | null;
  dropDayKey: string | null;
  selectedIssueId?: string | null;
  onSelectIssue?: (itemId: string) => void;
  onDragStart: (event: DragEvent, item: ChannelListItem) => void;
  onDragEnd: () => void;
  onDayDragOver: (event: DragEvent, dayKey: string) => void;
  onDayDragLeave: (dayKey: string) => void;
  onDayDrop: (event: DragEvent, dayKey: string | null) => void;
  onOpenBoardHint?: () => void;
};

export function ListsWeekView({
  items,
  weekAnchor,
  onWeekAnchorChange,
  draggingId,
  dropDayKey,
  selectedIssueId = null,
  onSelectIssue,
  onDragStart,
  onDragEnd,
  onDayDragOver,
  onDayDragLeave,
  onDayDrop,
}: ListsWeekViewProps) {
  const weekStart = startOfWeek(weekAnchor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const todayKey = toDateKey(new Date());
  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${weekStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} – ${weekEnd.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  const undated = items.filter((item) => !item.dueAt);
  const byDay = new Map<string, ChannelListItem[]>();
  for (const day of days) {
    byDay.set(toDateKey(day), []);
  }
  for (const item of items) {
    if (!item.dueAt) continue;
    const key = toDateKey(item.dueAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
  }

  return (
    <div className="list-week">
      <div className="list-week-toolbar">
        <div className="list-week-nav">
          <button
            type="button"
            className="ghost"
            aria-label="Previous week"
            onClick={() => onWeekAnchorChange(addDays(weekStart, -7))}
          >
            ‹
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onWeekAnchorChange(new Date())}
          >
            Today
          </button>
          <button
            type="button"
            className="ghost"
            aria-label="Next week"
            onClick={() => onWeekAnchorChange(addDays(weekStart, 7))}
          >
            ›
          </button>
        </div>
        <strong className="list-week-range">{weekLabel}</strong>
        <p className="muted list-week-hint">
          Drag tasks onto a day to set the due date · drop on Undated to clear
        </p>
      </div>

      <div className="list-week-grid" role="list">
        {days.map((day) => {
          const key = toDateKey(day);
          const dayItems = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isDrop = dropDayKey === key;
          return (
            <section
              key={key}
              className={`list-week-day${isToday ? ' is-today' : ''}${
                isDrop ? ' drop-target' : ''
              }${draggingId ? ' is-dragging' : ''}`}
              aria-label={day.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
              onDragOver={(event) => onDayDragOver(event, key)}
              onDragLeave={() => onDayDragLeave(key)}
              onDrop={(event) => void onDayDrop(event, key)}
            >
              <header className="list-week-day-head">
                <strong>
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </strong>
                <span>{day.getDate()}</span>
                <em>{dayItems.length}</em>
              </header>
              <ul className="list-week-day-items">
                {dayItems.map((item) => (
                  <li
                    key={item.id}
                    className={`list-week-chip status-${item.status}${
                      draggingId === item.id ? ' dragging' : ''
                    }${selectedIssueId === item.id ? ' is-selected' : ''}`}
                    draggable
                    title={item.title}
                    onClick={() => onSelectIssue?.(item.id)}
                    onDragStart={(event) => onDragStart(event, item)}
                    onDragEnd={onDragEnd}
                  >
                    <span className="list-week-chip-title">{item.title}</span>
                  </li>
                ))}
              </ul>
              {dayItems.length === 0 ? (
                <p className="muted list-week-empty">
                  {draggingId ? 'Drop here' : '—'}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>

      <section
        className={`list-week-undated${
          dropDayKey === '__undated__' ? ' drop-target' : ''
        }${draggingId ? ' is-dragging' : ''}`}
        aria-label="Undated tasks"
        onDragOver={(event) => onDayDragOver(event, '__undated__')}
        onDragLeave={() => onDayDragLeave('__undated__')}
        onDrop={(event) => void onDayDrop(event, null)}
      >
        <header className="list-week-day-head">
          <strong>Undated</strong>
          <em>{undated.length}</em>
        </header>
        <ul className="list-week-day-items list-week-undated-items">
          {undated.map((item) => (
            <li
              key={item.id}
              className={`list-week-chip status-${item.status}${
                draggingId === item.id ? ' dragging' : ''
              }${selectedIssueId === item.id ? ' is-selected' : ''}`}
              draggable
              title={item.title}
              onClick={() => onSelectIssue?.(item.id)}
              onDragStart={(event) => onDragStart(event, item)}
              onDragEnd={onDragEnd}
            >
              <span className="list-week-chip-title">{item.title}</span>
            </li>
          ))}
        </ul>
        {undated.length === 0 ? (
          <p className="muted list-week-empty">No undated tasks</p>
        ) : null}
      </section>
    </div>
  );
}
