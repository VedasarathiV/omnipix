// The one OmniPix mark, used everywhere (rail, splash, auth, onboarding).
// Matches desktop/assets/appicon_1024.png: green broken ring, white core.
export function Logo({ size = 40, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="OmniPix"
      className={spin ? 'logo-spin' : undefined}
    >
      <path
        d="M 77.7 34 A 32 32 0 1 1 66 22.3"
        fill="none"
        stroke="#10B981"
        strokeWidth="9"
      />
      <circle cx="50" cy="50" r="17" fill="#FFFFFF" />
    </svg>
  );
}
