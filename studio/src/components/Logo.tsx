// The one OmniPix mark, used everywhere (rail, splash, auth, onboarding,
// favicon, client brand). It matches the desktop dock icon exactly: dark
// tile, emerald arc with a top-right gap, white core. Fixed colors on
// purpose — a brand mark stays constant in every theme.
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
      <rect x="2" y="2" width="96" height="96" rx="22" fill="#0b1110" />
      <path
        d="M 77.7 34 A 32 32 0 1 1 66 22.3"
        fill="none"
        stroke="#10b981"
        strokeWidth="8"
      />
      <circle cx="50" cy="50" r="16" fill="#ffffff" />
    </svg>
  );
}
