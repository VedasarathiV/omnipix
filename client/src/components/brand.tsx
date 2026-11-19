import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'

// The OmniPix mark: orbit ring on the brand accent. One definition shared by
// the navbar, the workbench activity bar, and the desktop title strip. It
// follows the primary token, so it tracks the theme in both modes.

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <rect width="64" height="64" rx="14" fill="var(--primary)" />
      <circle cx="32" cy="32" r="9.5" fill="var(--primary-foreground)" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="var(--primary-foreground)" strokeOpacity=".55"
        strokeWidth="4.5" strokeLinecap="round" strokeDasharray="86 27"
        transform="rotate(-60 32 32)" />
    </svg>
  )
}

export function Brand() {
  const { t } = useI18n()
  return (
    <Link to="/" className="flex items-center gap-2 transition-opacity hover:opacity-70" aria-label={t('nav.home')}>
      <BrandMark />
      <span className="font-semibold tracking-tight text-sm">OmniPix</span>
    </Link>
  )
}
