// The one OmniPix mark, used everywhere (rail, splash, auth, onboarding).
// Theme-aware: accent ring, foreground core (the old hardcoded emerald +
// white core clashed with the blue theme and vanished in light mode).
export function Logo({ size = 40, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="OmniPix"
      className={spin ? 'logo-pulse' : undefined}
    >
      <path
        d="M 77.7 34 A 32 32 0 1 1 66 22.3"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <circle cx="50" cy="50" r="17" fill="var(--fg)" />
    </svg>
  );
}
