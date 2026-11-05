import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Blocks,
  FlaskConical,
  Hammer,
  Palette,
  PenLine,
  Plus,
  ScrollText,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react'
import {
  BUILTIN_COPILOTS,
  copilotSpawnRequest,
  createCopilotRegistry,
  listCopilots,
  registerCustomCopilot,
  type CopilotDefinition,
  type CopilotRegistry
} from '../../../../packages/neuro/src/copilots'
import type { NeuroSessionView } from '../../../../shared/neuro-sessions-contract'
import type { NeuroSessionsSnapshot } from '../../../../shared/neuro-sessions-contract'
import CopilotCustomForm from './CopilotCustomForm'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
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
const NO_MODEL = 'default'
// Static fallback when the provider registry IPC is unavailable.
const STATIC_MODELS: readonly string[] = [NO_MODEL]

const TILE_ICONS: Record<string, LucideIcon> = {
  archivist: ScrollText,
  forge: Hammer,
  sentinel: ShieldCheck,
  prism: Palette,
  inkwell: PenLine,
  scaffold: Blocks,
  verifier: FlaskConical
}
const TILE_ACCENTS: Record<string, string> = {
  archivist: 'text-chart-1',
  forge: 'text-chart-2',
  sentinel: 'text-chart-3',
  prism: 'text-chart-4',
  inkwell: 'text-chart-5',
  scaffold: 'text-chart-2',
  verifier: 'text-chart-1'
}

type ChatEntry = {
  taskId: string
  copilotId: string
  persona: string
  prompt: string
}

export default function CopilotPanel(): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const [registry, setRegistry] = useState<CopilotRegistry>(createCopilotRegistry)
  const [selectedId, setSelectedId] = useState<string>(BUILTIN_COPILOTS[0]?.id ?? '')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [modelChoice, setModelChoice] = useState(NO_MODEL)
  const [models, setModels] = useState<readonly string[]>(STATIC_MODELS)
  const [chat, setChat] = useState<readonly ChatEntry[]>([])
  const [sessions, setSessions] = useState<ReadonlyMap<string, NeuroSessionView>>(new Map())
  const [tentacles, setTentacles] = useState<readonly string[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [spawning, setSpawning] = useState(false)
  const [showCustomForm, setShowCustomForm] = useState(false)

  const copilots = useMemo(() => listCopilots(registry), [registry])
  const selected = copilots.find((copilot) => copilot.id === selectedId) ?? copilots[0]

  // Live Ganglion session status for everything this panel spawned.
  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      const api = window.api?.neuroSessions
      if (!api) {
        return
      }
      void api
        .list()
        .then((snapshot: NeuroSessionsSnapshot) => {
          if (!cancelled) {
            setSessions(new Map(snapshot.tasks.map((task) => [task.taskId, task])))
            setTentacles(snapshot.tentacles)
          }
        })
        .catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  // Model override options come from the provider registry IPC when exposed.
  useEffect(() => {
    const api = window.api?.neuroProviders
    if (!api) {
      return
    }
    void api
      .getStatus()
      .then((status) => {
        const options = status.profiles.flatMap((profile) =>
          profile.models.map((model) => `${profile.id}/${model}`)
        )
        setModels(options.length > 0 ? [NO_MODEL, ...options] : STATIC_MODELS)
      })
      .catch(() => undefined)
  }, [])

  const spawn = useCallback(async () => {
    const api = window.api?.neuroSessions
    if (!api || !selected || spawning) {
      return
    }
    if (activeWorktreeId === null) {
      setFormError(
        translate(
          'auto.components.neuro.CopilotPanel.noWorkspace',
          'Open a workspace first — copilot sessions run inside it.'
        )
      )
      return
    }
    setSpawning(true)
    setFormError(null)
    try {
      const withModel: CopilotDefinition =
        modelChoice === NO_MODEL ? selected : { ...selected, modelOverride: modelChoice }
      const request = copilotSpawnRequest(withModel, {
        title: taskTitle.trim(),
        prompt: taskPrompt
      })
      const outcome = await api.spawn({
        tentacle: request.tentacle,
        title: request.title,
        prompt: request.prompt,
        worktree: activeWorktreeId
      })
      if (outcome.ok) {
        setChat((entries) => [
          ...entries,
          {
            taskId: outcome.taskId,
            copilotId: selected.id,
            persona: selected.persona,
            prompt: taskPrompt
          }
        ])
        setTaskTitle('')
        setTaskPrompt('')
      } else {
        setFormError(outcome.reason)
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSpawning(false)
    }
  }, [activeWorktreeId, modelChoice, selected, spawning, taskPrompt, taskTitle])

  const tasks = chat.map((entry) => ({ entry, session: sessions.get(entry.taskId) }))
  const canSpawn =
    selected !== undefined && taskTitle.trim().length > 0 && taskPrompt.trim().length > 0

  return (
    <main className="relative flex h-full min-h-0 flex-1 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header className="flex shrink-0 items-center gap-3 px-3 pb-3 md:px-5">
        <h1 className="truncate text-base font-semibold leading-8">
          {translate('auto.components.neuro.CopilotPanel.title', 'Copilots')}
        </h1>
        <span className="text-2xs uppercase tracking-wider text-muted-foreground">
          {translate(
            'auto.components.neuro.CopilotPanel.subtitle',
            'Persona copilots delegated through Ganglion'
          )}
        </span>
      </header>

      <section className="mx-3 mb-4 grid gap-1.5 md:mx-5" aria-label="Copilot personas">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {copilots.map((copilot) => {
            const Icon = copilot.custom ? Plus : (TILE_ICONS[copilot.id] ?? Plus)
            const active = selected?.id === copilot.id
            return (
              <button
                key={copilot.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedId(copilot.id)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-md border p-2 text-left transition-colors',
                  active
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'border-border bg-background hover:bg-accent/50'
                )}
              >
                <Icon
                  className={cn('size-4 shrink-0', TILE_ACCENTS[copilot.id] ?? 'text-chart-3')}
                />
                <span className="w-full truncate text-[13px] font-medium">{copilot.persona}</span>
                <span className="truncate text-2xs text-muted-foreground">
                  {copilot.toolGrants.join(' · ')}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setShowCustomForm((open) => !open)}
            aria-expanded={showCustomForm}
            className="flex flex-col items-start gap-1 rounded-md border border-dashed border-border p-2 text-left text-muted-foreground transition-colors hover:bg-accent/50"
          >
            <Plus className="size-4 shrink-0" />
            <span className="text-[13px] font-medium">
              {translate('auto.components.neuro.CopilotPanel.addCustom', 'Custom…')}
            </span>
          </button>
        </div>
      </section>

      {showCustomForm ? (
        <CopilotCustomForm
          tentacles={tentacles}
          onRegister={(input) => {
            setRegistry((current) => {
              const outcome = registerCustomCopilot(current, input)
              if (!outcome.ok) {
                setFormError(outcome.reason)
                return current
              }
              setSelectedId(outcome.copilot.id)
              setShowCustomForm(false)
              return outcome.registry
            })
          }}
        />
      ) : null}

      {selected ? (
        <section className="mx-3 mb-4 grid gap-2 rounded-md border border-border p-3 md:mx-5 md:grid-cols-[1fr_220px_auto]">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="copilot-task-title">
                {translate('auto.components.neuro.CopilotPanel.taskTitle', 'Task')}
              </Label>
              <Input
                id="copilot-task-title"
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder={translate(
                  'auto.components.neuro.CopilotPanel.taskTitlePlaceholder',
                  'Summarize the auth module'
                )}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="copilot-task-prompt">
                {translate('auto.components.neuro.CopilotPanel.prompt', 'Prompt')}
              </Label>
              <Textarea
                id="copilot-task-prompt"
                value={taskPrompt}
                onChange={(event) => setTaskPrompt(event.target.value)}
                rows={2}
                placeholder={translate(
                  'auto.components.neuro.CopilotPanel.promptPlaceholder',
                  `What should ${selected.persona} do?`
                )}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="copilot-model">
              {translate('auto.components.neuro.CopilotPanel.model', 'Model override')}
            </Label>
            <Select value={modelChoice} onValueChange={setModelChoice}>
              <SelectTrigger id="copilot-model" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model === NO_MODEL
                      ? translate('auto.components.neuro.CopilotPanel.defaultModel', 'Default')
                      : model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground" aria-label="Tool grants">
              {selected.toolGrants.join(' · ')}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void spawn()}
              disabled={!canSpawn || spawning}
            >
              {spawning
                ? translate('auto.components.neuro.CopilotPanel.spawning', 'Delegating…')
                : translate('auto.components.neuro.CopilotPanel.spawn', 'Delegate to copilot')}
            </Button>
          </div>
          {formError ? (
            <p className="text-xs text-destructive md:col-span-3" role="alert">
              {formError}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek px-3 pb-5 md:px-5">
        <div className="flex flex-col gap-3" aria-label="Copilot activity">
          {tasks.map(({ entry, session }) => (
            <article key={entry.taskId} className="rounded-md border border-border p-3">
              <header className="mb-1 flex items-center gap-2">
                <span className="text-2xs font-semibold uppercase tracking-wider text-chart-2">
                  {entry.persona}
                </span>
                <span className="text-[13px] font-medium">{session?.title ?? entry.prompt}</span>
                <span className="ml-auto text-2xs text-muted-foreground">
                  {session?.state ??
                    translate('auto.components.neuro.CopilotPanel.queued', 'queued')}
                </span>
              </header>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{entry.prompt}</p>
              {session?.detail ? (
                <pre className="mt-2 max-h-32 overflow-auto scrollbar-sleek whitespace-pre-wrap rounded bg-muted p-2 text-2xs">
                  {session.detail.split('\n').slice(-8).join('\n')}
                </pre>
              ) : null}
            </article>
          ))}
          {tasks.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              {translate(
                'auto.components.neuro.CopilotPanel.empty',
                'No copilot runs yet — pick a persona and delegate a task.'
              )}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  )
}
