/** Clear-after helpers for status tray (server stores statusClearsAt). */

export type ClearAfterOption =
  | 'never'
  | '30m'
  | '1h'
  | '4h'
  | 'today';

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

export function computeClearAt(
  option: ClearAfterOption,
  from = new Date(),
): Date | null {
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

export function formatUntilPhrase(clearsAt: Date): string {
  return clearsAt.toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Append “until 3:00 PM” when scheduling a clear, without duplicating. */
export function withUntilSuffix(
  text: string,
  clearsAt: Date | null,
): string {
  const trimmed = text.trim();
  if (!clearsAt || !trimmed) return trimmed;
  if (/\buntil\b/i.test(trimmed)) return trimmed;
  return `${trimmed} until ${formatUntilPhrase(clearsAt)}`.slice(0, 100);
}

export function inferClearOption(
  clearsAtIso: string | null | undefined,
): ClearAfterOption {
  if (!clearsAtIso) return 'never';
  const clearsAt = new Date(clearsAtIso).getTime();
  if (Number.isNaN(clearsAt)) return 'never';
  const delta = clearsAt - Date.now();
  if (delta <= 0) return 'never';
  const minutes = delta / 60_000;
  if (minutes <= 35) return '30m';
  if (minutes <= 70) return '1h';
  if (minutes <= 260) return '4h';
  return 'today';
}
