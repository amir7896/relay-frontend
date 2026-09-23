/** Helpers for timezone-smart schedule send (no extra date libs). */

export type SchedulePeerContext = {
  userId: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
};

export type ScheduleContext = {
  conversationId: string;
  conversationType: 'private' | 'group';
  myTimezone: string;
  peer: SchedulePeerContext | null;
};

function zonedParts(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '0';
    let hour = Number(get('hour'));
    if (hour === 24) hour = 0;
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      hour,
      minute: Number(get('minute')),
    };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }
}

function parseHm(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...options,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function shortTimeZoneLabel(timeZone: string): string {
  const parts = timeZone.split('/');
  const city = parts[parts.length - 1] || timeZone;
  return city.replace(/_/g, ' ');
}

/** True if `at` falls inside peer quiet hours in their timezone. */
export function isQuietAt(
  peer: Pick<
    SchedulePeerContext,
    'quietHoursEnabled' | 'quietStart' | 'quietEnd' | 'timezone'
  >,
  at: Date,
): boolean {
  if (!peer.quietHoursEnabled) return false;
  const start = parseHm(peer.quietStart);
  const end = parseHm(peer.quietEnd);
  if (start === null || end === null) return false;
  const { hour, minute } = zonedParts(at, peer.timezone);
  const minutes = hour * 60 + minute;
  if (start <= end) {
    return minutes >= start && minutes < end;
  }
  return minutes >= start || minutes < end;
}

/**
 * Next wall-clock time (hour:minute) in `timeZone` at/after `after`.
 * Scans minute-by-minute (fine for UI suggestions).
 */
export function nextWallClockInZone(
  timeZone: string,
  hour: number,
  minute: number,
  after = new Date(),
): Date {
  const stepMs = 60_000;
  const end = after.getTime() + 4 * 24 * 60 * 60 * 1000;
  for (let t = after.getTime() + stepMs; t <= end; t += stepMs) {
    const parts = zonedParts(new Date(t), timeZone);
    if (parts.hour === hour && parts.minute === minute) {
      return new Date(t);
    }
  }
  return new Date(after.getTime() + 24 * 60 * 60 * 1000);
}

/** First minute after quiet hours end in the peer timezone. */
export function nextAfterQuietHours(
  peer: SchedulePeerContext,
  after = new Date(),
): Date | null {
  if (!peer.quietHoursEnabled) return null;
  const end = parseHm(peer.quietEnd);
  if (end === null) return null;
  const hour = Math.floor(end / 60);
  const minute = end % 60;
  return nextWallClockInZone(peer.timezone, hour, minute, after);
}

export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDatetimeLocalValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
