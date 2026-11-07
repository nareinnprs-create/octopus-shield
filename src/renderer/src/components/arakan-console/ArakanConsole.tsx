import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArakanConsoleEvent } from '../../../../shared/arakan-console-contract'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ConsoleRow =
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'tool'; toolCallId: string; title: string; status?: string; output?: string }
  | { kind: 'notice'; text: string }

type PendingPermission = {
  requestId: string | number
  toolCallTitle?: string
  options: readonly { optionId: string; kind: string; name?: string }[]
}

const statusTone = (status?: string): string =>
  status === 'completed' || status === 'success'
    ? 'border-emerald-600/50 text-emerald-600 dark:text-emerald-400'
    : status === 'failed' || status === 'error'
      ? 'border-destructive/50 text-destructive'
      : ''

export default function ArakanConsole(): React.JSX.Element {
  const [rows, setRows] = useState<ConsoleRow[]>([])
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cwd = useAppStoreCwd()

  useEffect(() => {
    const api = window.api?.arakanConsole
    if (!api) {
      return
    }
    return api.onEvent((event: ArakanConsoleEvent) => {
      if (event.kind === 'permission-request') {
        setPendingPermission({
          requestId: event.request.requestId,
          ...(event.request.toolCallTitle === undefined
            ? {}
            : { toolCallTitle: event.request.toolCallTitle }),
          options: event.request.options
        })
      }
      setRows((previous) => {
        const next = [...previous]
        if (event.kind === 'agent-message') {
          const last = next.at(-1)
          if (last?.kind === 'agent') {
            next[next.length - 1] = { kind: 'agent', text: last.text + event.text }
            return next
          }
          next.push({ kind: 'agent', text: event.text })
        } else if (event.kind === 'tool-call') {
          next.push({
            kind: 'tool',
            toolCallId: event.toolCallId,
            title: event.title,
            status: event.status
          })
        } else if (event.kind === 'tool-call-update') {
          const index = next.findLastIndex(
            (row) => row.kind === 'tool' && row.toolCallId === event.toolCallId
          )
          if (index !== -1) {
            const row = next[index] as Extract<ConsoleRow, { kind: 'tool' }>
            next[index] = {
              ...row,
              status: event.status ?? row.status,
              output: event.output ?? row.output
            }
          }
        } else if (event.kind === 'notice') {
          next.push({ kind: 'notice', text: event.text })
        } else if (event.kind === 'exited') {
          setOpen(false)
          setPendingPermission(null)
          next.push({ kind: 'notice', text: `arakan acp exited (${event.code ?? 'signal'})` })
        }
        return next
      })
    })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [rows])

  const openConsole = useCallback(() => {
    const api = window.api?.arakanConsole
    if (!api || openError !== null) {
      return
    }
    setOpening(true)
    setOpenError(null)
    api
      .open({ cwd })
      .then((result) => {
        if (result.ok) {
          setOpen(true)
          setRows([
            {
              kind: 'notice',
              text: `arakan acp ready (${result.backendVersion ?? 'unknown version'}) · cwd: ${cwd}`
            }
          ])
        } else {
          setOpenError(result.reason)
        }
      })
      .catch((error: unknown) =>
        setOpenError(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setOpening(false))
  }, [cwd, openError])

  const send = useCallback(() => {
    const api = window.api?.arakanConsole
    const text = draft.trim()
    if (!api || !open || text.length === 0 || sending) {
      return
    }
    setSending(true)
    setRows((previous) => [...previous, { kind: 'user', text }])
    setDraft('')
    api
      .prompt({ text })
      .then((result) => {
        if (!result.ok) {
          setRows((previous) => [
            ...previous,
            { kind: 'notice', text: `prompt failed: ${result.reason ?? 'unknown'}` }
          ])
        }
      })
      .catch((error: unknown) =>
        setRows((previous) => [
          ...previous,
          { kind: 'notice', text: error instanceof Error ? error.message : String(error) }
        ])
      )
      .finally(() => setSending(false))
  }, [draft, open, sending])

  const respond = useCallback(
    (optionId: string) => {
      const api = window.api?.arakanConsole
      if (!api || pendingPermission === null) {
        return
      }
      void api
        .respondPermission({ requestId: pendingPermission.requestId, optionId })
        .then((result) => {
          if (result.ok) {
            setRows((previous) => [
              ...previous,
              { kind: 'notice', text: `permission → ${optionId}` }
            ])
            setPendingPermission(null)
            return
          }
          setRows((previous) => [
            ...previous,
            { kind: 'notice', text: 'permission response was rejected' }
          ])
        })
        .catch((error: unknown) => {
          setRows((previous) => [
            ...previous,
            {
              kind: 'notice',
              text: error instanceof Error ? error.message : String(error)
            }
          ])
        })
    },
    [pendingPermission]
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {!open ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <span>
              {translate(
                'auto.components.arakan-console.idle',
                'Arakan Console — chat with the built-in agent brain.'
              )}
            </span>
            <Button type="button" onClick={openConsole} disabled={opening}>
              {opening
                ? translate('auto.components.arakan-console.starting', 'Starting arakan acp…')
                : translate('auto.components.arakan-console.start', 'Start console')}
            </Button>
            {openError !== null ? <span className="text-destructive">{openError}</span> : null}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 scrollbar-sleek"
          >
            {rows.map((row, index) =>
              row.kind === 'user' ? (
                <div
                  key={index}
                  className="self-end rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground max-w-[80%] whitespace-pre-wrap"
                >
                  {row.text}
                </div>
              ) : row.kind === 'agent' ? (
                <div
                  key={index}
                  className="self-start rounded-lg bg-muted px-3 py-1.5 text-sm max-w-[80%] whitespace-pre-wrap"
                >
                  {row.text}
                </div>
              ) : row.kind === 'tool' ? (
                <div key={index} className="self-start flex items-center gap-2 max-w-[80%]">
                  <Badge
                    variant="outline"
                    className={cn('font-mono text-[11px]', statusTone(row.status))}
                  >
                    tool · {row.title}
                    {row.status ? ` · ${row.status}` : ''}
                  </Badge>
                  {row.output ? (
                    <span className="truncate text-xs text-muted-foreground" title={row.output}>
                      {row.output}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div key={index} className="self-start text-xs text-muted-foreground">
                  {row.text}
                </div>
              )
            )}
          </div>
          {pendingPermission !== null ? (
            <div className="rounded-lg border border-amber-600/50 bg-amber-500/5 p-2 text-sm">
              <div className="font-medium">
                {translate('auto.components.arakan-console.permission', 'Permission requested')}
                {pendingPermission.toolCallTitle ? `: ${pendingPermission.toolCallTitle}` : ''}
              </div>
              <div className="mt-1 flex gap-2">
                {pendingPermission.options.map((option) => (
                  <Button
                    key={option.optionId}
                    type="button"
                    size="sm"
                    variant={option.kind.includes('reject') ? 'outline' : 'default'}
                    onClick={() => respond(option.optionId)}
                  >
                    {option.name ?? option.kind ?? option.optionId}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
              placeholder={translate(
                'auto.components.arakan-console.placeholder',
                'Message Arakan… (Enter sends, Shift+Enter newline)'
              )}
              className="min-h-[60px] flex-1 resize-none"
            />
            <Button type="button" onClick={send} disabled={sending || draft.trim().length === 0}>
              {translate('auto.components.arakan-console.send', 'Send')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Console operates on the active worktree checkout, matching Neuro sessions. */
function useAppStoreCwd(): string {
  return useAppStore((state) =>
    state.activeWorktreeId === null
      ? ''
      : (findWorktreeById(selectWorktreesByRepo(state) ?? {}, state.activeWorktreeId)?.path ?? '')
  )
}
