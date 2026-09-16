/** Slack-style over-ear headphones icon used for ambient huddles. */
export function HuddleIcon({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 3C7.03 3 3 7.03 3 12v5a3 3 0 0 0 3 3h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H6.1A5.91 5.91 0 0 1 12 6.1 5.91 5.91 0 0 1 17.9 12H16a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2a3 3 0 0 0 3-3v-5c0-4.97-4.03-9-9-9z"
      />
    </svg>
  );
}
