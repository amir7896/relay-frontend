/** Client-side “clear status after” — API has no expiry field. */

export type ClearAfterOption =
  | 'never'
  | '30m'
  | '1h'
  | '4h'
  | 'today';

export type StatusClearRecord = {
  clearsAt: string;
  option: ClearAfterOption;
};

const PREFIX = 'relay:status-clear:';

export function clearAfterLabel(option: ClearAfterOption): string {
  switch (option) {
    case '30m':
      return '30 minutes';
    case '1h':
      return '1 hour';
    case '4h':
      return '4 hours';
    case 'today':
      return 'Today';
    default:
      return "Don't clear";
  }
}

export function computeClearAt(option: ClearAfterOption, from = new Date()): Date | null {
  if (option === 'never') return null;
  const at = new Date(from);
  if (option === '30m') {
    at.setMinutes(at.getMinutes() + 30);
    return at;
  }
  if (option === '1h') {
    at.setHours(at.getHours() + 1);
    return at;
  }
  if (option === '4h') {
    at.setHours(at.getHours() + 4);
    return at;
  }
  // End of local day
  at.setHours(23, 59, 59, 999);
  if (at.getTime() <= from.getTime()) {
    at.setDate(at.getDate() + 1);
  }
  return at;
}

export function readStatusClear(userId: string): StatusClearRecord | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StatusClearRecord;
    if (!parsed?.clearsAt || !parsed?.option) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStatusClear(
  userId: string,
  option: ClearAfterOption,
): StatusClearRecord | null {
  const clearsAt = computeClearAt(option);
  if (!clearsAt) {
    clearStatusClear(userId);
    return null;
  }
  const record: StatusClearRecord = {
    clearsAt: clearsAt.toISOString(),
    option,
  };
  localStorage.setItem(`${PREFIX}${userId}`, JSON.stringify(record));
  return record;
}

export function clearStatusClear(userId: string) {
  localStorage.removeItem(`${PREFIX}${userId}`);
}
