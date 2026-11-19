import { KeyRound, LogOut, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { logout } from '@/lib/api'

// The account menu contents, shared by the mobile navbar and the workbench
// activity bar. Dialogs open via callbacks so the shell owns the state once.

export interface AccountMenuItemsProps {
  showUpgrade: boolean
  upgradeLabel: string
  settingsLabel: string
  updatesLabel: string
  signOutLabel: string
  changeEmailLabel: string
  changePasswordLabel: string
  onUpgrade: () => void
  onOpenSettings: () => void
  onOpenUpdates: () => void
  onChangeEmail: () => void
  onChangePassword: () => void
  /** Desktop signs in with a hidden local account: no credentials, no sign-out. */
  isDesktopApp: boolean
}

export function AccountMenuItems({
  showUpgrade,
  upgradeLabel,
  settingsLabel,
  updatesLabel,
  signOutLabel,
  changeEmailLabel,
  changePasswordLabel,
  onUpgrade,
  onOpenSettings,
  onOpenUpdates,
  onChangeEmail,
  onChangePassword,
  isDesktopApp,
}: AccountMenuItemsProps) {
  return (
    <>
      {showUpgrade && (
        <DropdownMenuItem onClick={onUpgrade}>
          <Sparkles />
          {upgradeLabel}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={onOpenSettings}>
        <Settings />
        {settingsLabel}
      </DropdownMenuItem>
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
