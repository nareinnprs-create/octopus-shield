import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '../store'

async function copySignInLink(link: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(link)
    toast.success(translate('auto.components.ShieldSignInProgress.copied', 'Sign-in link copied'))
  } catch (error) {
    console.warn('Could not copy the Shield sign-in link:', error)
    toast.error(
      translate('auto.components.ShieldSignInProgress.copyFailed', 'Could not copy the link.')
    )
  }
}

export function ShieldSignInButton({
  children,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'onClick' | 'type'>): React.JSX.Element {
  const connect = useAppStore((state) => state.connectCurrentShieldProfile)
  const signingIn = useAppStore((state) => Boolean(state.shieldProfileSignInProgress))
  return (
    <Button
      {...props}
      type="button"
      disabled={disabled || signingIn}
      onClick={() => void connect()}
    >
      {signingIn ? (
        <>
          <Loader2 className="animate-spin" />
          {translate('auto.components.ShieldSignInProgress.signingIn', 'Signing in…')}
        </>
      ) : (
        children
      )}
    </Button>
  )
}

export function ShieldSignInWaitNotice({
  className
}: {
  className?: string
}): React.JSX.Element | null {
  const link = useAppStore((state) => state.shieldProfileSignInProgress?.link)
  if (!link) {
    return null
  }
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-0.5 text-xs text-muted-foreground',
        className
      )}
    >
      <span className="pr-2">
        {translate(
          'auto.components.ShieldSignInProgress.waiting',
          'Waiting for sign-in in your browser'
        )}
      </span>
      <span aria-hidden>·</span>
      <Button type="button" variant="link" size="xs" onClick={() => void copySignInLink(link)}>
        {translate('auto.components.ShieldSignInProgress.copyLink', 'Copy sign-in link')}
      </Button>
      <span aria-hidden>·</span>
      <Button
        type="button"
        variant="link"
        size="xs"
        onClick={() => void window.api.shieldProfiles.cancelSignIn().catch(() => {})}
      >
        {translate('auto.components.ShieldSignInProgress.cancel', 'Cancel')}
      </Button>
    </div>
  )
}
