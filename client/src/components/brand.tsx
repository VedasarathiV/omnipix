import { Link } from 'react-router-dom'
import { useI18n } from '@/i18n'

// The OmniPix mark, identical to the desktop dock icon and the studio Logo:
// dark tile, emerald arc with a top-right gap, white core. One geometry
// everywhere (viewBox scales it); fixed colors, independent of the theme.

export function BrandMark({ size = 18, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
      <rect x="2" y="2" width="96" height="96" rx="22" fill="#0b1110" />
      <path
        d="M 77.7 34 A 32 32 0 1 1 66 22.3"
        fill="none"
        stroke="#10b981"
        strokeWidth="8"
        className={animated ? 'ox-brand-arc' : undefined}
      />
      <circle cx="50" cy="50" r="16" fill="#ffffff" className={animated ? 'ox-brand-core' : undefined} />
    </svg>
  )
}

export function Brand() {
  const { t } = useI18n()
  return (
    <Link to="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-70" aria-label={t('nav.home')}>
      <BrandMark size={26} animated />
      <span className="font-semibold tracking-tight text-base">OmniPix</span>
    </Link>
  )
}
