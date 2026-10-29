import type { AgentSessionShieldStopCause } from '../agent-session-shield-stop'
import { joinSentences } from '../sentence-joining'

/** English pieces; desktop translates each with the same fallback, the phone keeps English. */
export const NATIVE_CHAT_OSHIELD_STOP_COPY = {
  update: 'Shield on {{machine}} restarted for an update while this response was in progress.',
  quit: 'Shield on {{machine}} was closed while this response was in progress.',
  crash: 'Shield on {{machine}} stopped unexpectedly while this response was in progress.',
  // A remote graceful stop is a server stop or a shared desktop's quit; "stopped" is true of both.
  remote: 'Shield on {{machine}} stopped while this response was in progress.',
  canContinue: 'You can continue in this conversation.',
  unnamedServer: 'the remote server'
} as const

export type NativeChatShieldStopCopyId = keyof typeof NATIVE_CHAT_OSHIELD_STOP_COPY
export type NativeChatShieldStopSay = (id: NativeChatShieldStopCopyId, machine?: string) => string

export const sayNativeChatShieldStopEnglish: NativeChatShieldStopSay = (id, machine) =>
  machine === undefined
    ? NATIVE_CHAT_OSHIELD_STOP_COPY[id]
    : NATIVE_CHAT_OSHIELD_STOP_COPY[id].replace('{{machine}}', () => machine)

/** Base wording on host continuation support so the sentence stays stable as the button changes. */
export function nativeChatShieldStopRowText(
  cause: AgentSessionShieldStopCause,
  machine: string,
  options: { continueAvailable: boolean; remoteHost: boolean },
  say: NativeChatShieldStopSay = sayNativeChatShieldStopEnglish
): string {
  const stopped = say(cause === 'quit' && options.remoteHost ? 'remote' : cause, machine)
  return options.continueAvailable ? stopped : joinSentences([stopped, say('canContinue')])
}
