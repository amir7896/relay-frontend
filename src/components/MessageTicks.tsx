/** WhatsApp-style delivery/read ticks for your own messages. */
export function MessageTicks({ seen }: { seen: boolean }) {
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
