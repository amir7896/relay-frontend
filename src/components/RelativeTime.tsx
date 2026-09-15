import { useEffect, useState } from 'react';
import { inboxTime } from '../lib/format';

/** Updates relative timestamps without re-rendering the whole messenger tree. */
export function RelativeTime({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!value) {
      return;
    }
    const timer = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [value]);

  const label = inboxTime(value);
  if (!label || !value) {
    return null;
  }
  return (
    <time className={className} dateTime={value}>
      {label}
    </time>
  );
}
