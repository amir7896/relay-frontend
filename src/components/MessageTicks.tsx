/** WhatsApp-style delivery/read ticks for your own messages. */
export function MessageTicks({
  seen,
  status = 'sent',
}: {
  seen: boolean;
  status?: 'pending' | 'failed' | 'sent';
}) {
  if (status === 'pending') {
    return (
      <span className="wa-ticks pending" aria-label="Sending">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M8 4.5v4l2.5 1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span className="wa-ticks failed" aria-label="Failed to send">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M8 4.5v4M8 11.2h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className={seen ? 'wa-ticks seen' : 'wa-ticks'} aria-label={seen ? 'Seen' : 'Sent'}>
      <svg viewBox="0 0 16 11" width="16" height="11" aria-hidden="true">
        <path
          d="M11.07 0.8 5.8 6.4 4.13 4.7 2.9 5.95l2.9 2.95L12.3 2.05z"
          fill="currentColor"
        />
        <path
          d="M14.9 0.8 9.63 6.4 8.7 5.45 7.48 6.7l2.15 2.2L16.13 2.05z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
