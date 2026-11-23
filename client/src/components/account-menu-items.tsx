import { KeyRound, LogOut, RefreshCw, Settings } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { logout } from '@/lib/api'

// The account menu contents, shared by the mobile navbar and the workbench
// activity bar. Dialogs open via callbacks so the shell owns the state once.

export interface AccountMenuItemsProps {
  /** Desktop workbench has a gear for settings — the menu skips it there. */
  showSettings?: boolean
  settingsLabel: string
  updatesLabel: string
  signOutLabel: string
  changeEmailLabel: string
  changePasswordLabel: string
  onOpenSettings: () => void
  onOpenUpdates: () => void
  onChangeEmail: () => void
  onChangePassword: () => void
  /** Desktop signs in with a hidden local account: no credentials, no sign-out. */
  isDesktopApp: boolean
}

export function AccountMenuItems({
  showSettings = true,
  settingsLabel,
  updatesLabel,
  signOutLabel,
  changeEmailLabel,
  changePasswordLabel,
  onOpenSettings,
  onOpenUpdates,
  onChangeEmail,
  onChangePassword,
  isDesktopApp,
}: AccountMenuItemsProps) {
  return (
    <>
      {showSettings && (
        <DropdownMenuItem onClick={onOpenSettings}>
          <Settings />
          {settingsLabel}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={onOpenUpdates}>
        <RefreshCw />
        {updatesLabel}
      </DropdownMenuItem>
      {/* Desktop signs in with a hidden local account, so it has no credentials
          to change and no session to end. */}
      {!isDesktopApp && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onChangeEmail}>
            <span className="flex size-4 items-center justify-center font-serif text-xs font-bold">@</span>
            {changeEmailLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onChangePassword}>
            <KeyRound />
            {changePasswordLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => logout()}>
            <LogOut />
            {signOutLabel}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}
