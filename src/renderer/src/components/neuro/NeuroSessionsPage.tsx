import { useCallback, useEffect, useState } from 'react'
import type { NeuroSessionView } from '../../../../shared/neuro-sessions-contract'
import type { NeuroSessionsSnapshot } from '../../../../shared/neuro-sessions-contract'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const POLL_INTERVAL_MS = 2_000

const stateLabel = (state: NeuroSessionView['state']): string =>
  translate(`auto.components.neuro.NeuroSessionsPage.state.${state}`, state)

export default function NeuroSessionsPage(): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const [snapshot, setSnapshot] = useState<NeuroSessionsSnapshot | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [tentacle, setTentacle] = useState<string>('')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [spawning, setSpawning] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      const api = window.api?.neuroSessions
      if (!api) {
        return
      }
      void api
        .list()
        .then((next) => {
          if (!cancelled) {
            setSnapshot(next)
            setListError(null)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setListError(error instanceof Error ? error.message : String(error))
          }
        })
    }
    poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (tentacle === '' && snapshot && snapshot.tentacles.length > 0) {
      setTentacle(snapshot.tentacles[0] ?? '')
    }
  }, [snapshot, tentacle])

  const spawn = useCallback(async () => {
    const api = window.api?.neuroSessions
    if (!api || spawning) {
      return
    }
    if (activeWorktreeId === null) {
      setFormError(
        translate(
          'auto.components.neuro.NeuroSessionsPage.noWorkspace',
          'Open a workspace first — Tentacle sessions run inside it.'
        )
      )
      return
    }
    setSpawning(true)
    setFormError(null)
    try {
      const outcome = await api.spawn({
        tentacle,
        title: title.trim(),
        prompt,
        worktree: activeWorktreeId
      })
      if (outcome.ok) {
        setTitle('')
        setPrompt('')
      } else {
        setFormError(outcome.reason)
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSpawning(false)
    }
  }, [activeWorktreeId, prompt, spawning, tentacle, title])

  const stop = useCallback(async (taskId: string) => {
    const api = window.api?.neuroSessions
    if (api) {
      await api.stop(taskId).catch(() => undefined)
    }
  }, [])

  const retry = useCallback(async (taskId: string) => {
    const api = window.api?.neuroSessions
    if (api) {
      await api.retry(taskId).catch(() => undefined)
    }
  }, [])

  const tasks = snapshot?.tasks ?? []

  return (
    <main className="relative flex h-full min-h-0 flex-1 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header
        className="flex shrink-0 items-center gap-3 px-3 pb-3 md:px-5"
        style={
          {
            paddingRight: 'max(0.75rem, var(--window-controls-width, 0px))'
          } as React.CSSProperties
        }
      >
        <h1 className="truncate text-base font-semibold leading-8">
          {translate('auto.components.neuro.NeuroSessionsPage.title', 'Neuro Sessions')}
        </h1>
        <span className="text-2xs uppercase tracking-wider text-muted-foreground">
          {translate(
            'auto.components.neuro.NeuroSessionsPage.subtitle',
            'Tentacle agents delegated through the Ganglion runtime'
          )}
        </span>
      </header>

      {listError ? (
        <div className="mx-3 mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive md:mx-5">
          {listError}
        </div>
      ) : null}

      <section className="mx-3 mb-4 grid gap-2 rounded-md border border-border p-3 md:mx-5 md:grid-cols-[180px_1fr_auto]">
        <div className="grid gap-1">
          <Label htmlFor="neuro-tentacle">
            {translate('auto.components.neuro.NeuroSessionsPage.tentacle', 'Tentacle')}
          </Label>
          <Select value={tentacle} onValueChange={setTentacle}>
            <SelectTrigger id="neuro-tentacle" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(snapshot?.tentacles ?? []).map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="neuro-title">
              {translate('auto.components.neuro.NeuroSessionsPage.taskTitle', 'Task')}
            </Label>
            <Input
              id="neuro-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={translate(
                'auto.components.neuro.NeuroSessionsPage.taskTitlePlaceholder',
                'Summarize the auth module'
              )}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="neuro-prompt">
              {translate('auto.components.neuro.NeuroSessionsPage.prompt', 'Prompt')}
            </Label>
            <Textarea
              id="neuro-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={2}
              placeholder={translate(
                'auto.components.neuro.NeuroSessionsPage.promptPlaceholder',
                'What should this Tentacle agent do?'
              )}
            />
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void spawn()}
            disabled={spawning || title.trim().length === 0 || prompt.trim().length === 0}
          >
            {spawning
              ? translate('auto.components.neuro.NeuroSessionsPage.spawning', 'Delegating…')
              : translate('auto.components.neuro.NeuroSessionsPage.spawn', 'Delegate task')}
          </Button>
        </div>
        {formError ? (
          <p className="text-xs text-destructive md:col-span-3" role="alert">
            {formError}
          </p>
        ) : null}
      </section>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-5 md:px-5">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">
                {translate('auto.components.neuro.NeuroSessionsPage.task', 'Task')}
              </th>
              <th className="py-2 pr-3 font-medium">
                {translate('auto.components.neuro.NeuroSessionsPage.tentacleColumn', 'Tentacle')}
              </th>
              <th className="py-2 pr-3 font-medium">
                {translate('auto.components.neuro.NeuroSessionsPage.status', 'Status')}
              </th>
              <th className="py-2 pr-3 font-medium">
                {translate('auto.components.neuro.NeuroSessionsPage.session', 'Session')}
              </th>
              <th className="py-2 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.taskId} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium">{task.title}</span>
                  {task.detail ? (
                    <span className="block max-w-[480px] truncate text-xs text-muted-foreground">
                      {task.detail.split('\n').at(-1)}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">{task.tentacle}</td>
                <td className="py-2 pr-3">{stateLabel(task.state)}</td>
                <td className="py-2 pr-3">
                  {task.worktreeId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveWorktree(task.worktreeId as string)}
                    >
                      {translate('auto.components.neuro.NeuroSessionsPage.open', 'Open workspace')}
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {task.state === 'running' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void stop(task.taskId)}
                    >
                      {translate('auto.components.neuro.NeuroSessionsPage.stop', 'Stop')}
                    </Button>
                  ) : null}
                  {task.state === 'failed' || task.state === 'interrupted' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void retry(task.taskId)}
                    >
                      {translate('auto.components.neuro.NeuroSessionsPage.retry', 'Retry')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  {snapshot === null
                    ? translate(
                        'auto.components.neuro.NeuroSessionsPage.loading',
                        'Loading sessions…'
                      )
                    : translate(
                        'auto.components.neuro.NeuroSessionsPage.empty',
                        'No Tentacle tasks yet — delegate one above.'
                      )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  )
}
