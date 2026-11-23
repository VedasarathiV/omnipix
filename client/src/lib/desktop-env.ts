// Desktop-shell detection. The Electron preload sets these flags; the web
// build never has them. Shared by the navbar, workbench title strip, and
// anything else that adapts its chrome to the desktop shell.

export const isDesktopApp = typeof window !== 'undefined'
  && (window as Window & { __OMNIPIX_DESKTOP__?: boolean }).__OMNIPIX_DESKTOP__ === true

export const desktopPlatform = typeof window !== 'undefined'
  ? (window as Window & { __OMNIPIX_PLATFORM__?: string }).__OMNIPIX_PLATFORM__
  : undefined

export const isMacDesktop = isDesktopApp && (
  desktopPlatform ? desktopPlatform === 'darwin' : (typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent))
)
