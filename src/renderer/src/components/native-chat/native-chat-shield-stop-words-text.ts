import { translate } from '@/i18n/i18n'
import {
  NATIVE_CHAT_OSHIELD_STOP_COPY as COPY,
  type NativeChatShieldStopCopyId,
  type NativeChatShieldStopSay
} from '../../../../shared/native-chat/native-chat-shield-stop-words'

const PIECES: Record<NativeChatShieldStopCopyId, (machine: string | undefined) => string> = {
  update: (machine) =>
    translate('components.native-chat.notices.shieldStopUpdate', COPY.update, { machine }),
  quit: (machine) =>
    translate('components.native-chat.notices.shieldStopQuit', COPY.quit, { machine }),
  crash: (machine) =>
    translate('components.native-chat.notices.shieldStopCrash', COPY.crash, { machine }),
  remote: (machine) =>
    translate('components.native-chat.notices.shieldStopRemote', COPY.remote, { machine }),
  canContinue: () =>
    translate('components.native-chat.notices.shieldStopCanContinue', COPY.canContinue),
  unnamedServer: () =>
    translate('components.native-chat.notices.shieldStopUnnamedServer', COPY.unnamedServer)
}

export const sayNativeChatShieldStopTranslated: NativeChatShieldStopSay = (id, machine) =>
  PIECES[id](machine)
