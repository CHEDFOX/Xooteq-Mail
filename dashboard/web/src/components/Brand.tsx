// The Xooteq Mail mark: an envelope whose two diagonals make the X, with a
// dot for the new message.
export function Mark({ size = 28, dot = true }: { size?: number; dot?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="mark">
      <rect width="32" height="32" rx="8" fill="var(--mark-bg)" />
      <rect x="6.5" y="9" width="19" height="14" rx="2.5" fill="none" stroke="var(--mark-fg)" strokeWidth="2" />
      <path d="M7.5 10l17 12M24.5 10l-17 12" stroke="var(--mark-fg)" strokeWidth="2" strokeLinecap="round" />
      {dot && <circle cx="25" cy="8.5" r="3.5" fill="var(--brand)" stroke="var(--mark-bg)" strokeWidth="1.5" />}
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark size={26} />
      <span>Xooteq <b>Mail</b></span>
    </span>
  );
}
