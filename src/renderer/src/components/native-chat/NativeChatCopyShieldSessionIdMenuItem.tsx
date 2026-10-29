import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

/** Copies the chat's Shield session ID from the host: `shield_session_id:<root>`, which `/clear` keeps. */
export function NativeChatCopyShieldSessionIdMenuItem({
  resolveShieldSessionId
}: {
  resolveShieldSessionId: () => Promise<string | null>
}): React.JSX.Element {
  const copyShieldSessionId = async (): Promise<void> => {
    try {
      const shieldSessionId = await resolveShieldSessionId()
      if (!shieldSessionId) {
        throw new Error('no Shield session ID')
      }
      await window.api.ui.writeClipboardText(shieldSessionId)
      toast.success(
        translate(
          'components.native-chat.contextMenu.shieldSessionIdCopied',
          'Shield session ID copied'
        )
      )
    } catch {
      toast.error(
        translate(
          'components.native-chat.contextMenu.shieldSessionIdCopyFailed',
          'Unable to copy Shield session ID'
        )
      )
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem onSelect={() => void copyShieldSessionId()}>
          <Copy />
          {translate(
            'components.native-chat.contextMenu.copyShieldSessionId',
            'Copy Shield Session ID'
          )}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
        {translate(
          'components.native-chat.contextMenu.shieldSessionIdTooltip',
          "Shield's ID for this chat, separate from the agent CLI's own session ID. Agents use it to refer to each other through Shield."
        )}
      </TooltipContent>
    </Tooltip>
  )
}
