import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ArmoryHealthReport,
  ArmoryRunOutcome,
  ArmoryScopeState,
  ArmoryToolView
} from '../../../../shared/armory-contract'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { ArmoryRunDialog } from './ArmoryRunDialog'
import { ArmoryRunOutput } from './ArmoryRunOutput'
import { ArmoryScopeBanner } from './ArmoryScopeBanner'
import { ArmoryToolsTable } from './ArmoryToolsTable'

export type ArmoryRunPhase =
  | { kind: 'idle' }
  | { kind: 'running'; toolId: string }
  | { kind: 'denied'; toolId: string; reason: string }
  | { kind: 'done'; toolId: string; outcome: Extract<ArmoryRunOutcome, { ok: true }> }

export default function ArmoryPage(): React.JSX.Element {
  const [tools, setTools] = useState<readonly ArmoryToolView[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [scope, setScope] = useState<ArmoryScopeState | null>(null)
  const [health, setHealth] = useState<ArmoryHealthReport | null>(null)
  const [healthRunning, setHealthRunning] = useState(false)
  const [runDialogToolId, setRunDialogToolId] = useState<string | null>(null)
  const [phase, setPhase] = useState<ArmoryRunPhase>({ kind: 'idle' })
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const armory = window.api?.armory
    if (!armory) {
      return
    }
    void Promise.all([armory.list(), armory.scope()])
      .then(([toolViews, scopeState]) => {
        if (cancelled) {
          return
        }
        setTools(toolViews)
        setScope(scopeState)
        setListError(null)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [reloadNonce])

  const runToolById = useCallback(
    (toolId: string) => tools?.find((tool) => tool.id === toolId) ?? null,
    [tools]
  )

  const runTool = useCallback(
    async (toolId: string, targets: readonly string[], args: readonly string[]) => {
      const armory = window.api?.armory
      if (!armory) {
        return
      }
      setPhase({ kind: 'running', toolId })
      try {
        const outcome = await armory.run({ toolId, targets: [...targets], args: [...args] })
        setPhase(
          outcome.ok
            ? { kind: 'done', toolId, outcome }
            : { kind: 'denied', toolId, reason: outcome.reason }
        )
      } catch (error) {
        setPhase({
          kind: 'denied',
          toolId,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
    },
    []
  )

  const runHealth = useCallback(async () => {
    const armory = window.api?.armory
    if (!armory || healthRunning) {
      return
    }
    setHealthRunning(true)
    try {
      setHealth(await armory.health())
    } catch {
      setHealth(null)
    } finally {
      setHealthRunning(false)
    }
  }, [healthRunning])

  const runDialogTool = useMemo(
    () => (runDialogToolId === null ? null : runToolById(runDialogToolId)),
    [runDialogToolId, runToolById]
  )
  const phaseTool = phase.kind === 'idle' ? null : (runToolById(phase.toolId) ?? null)

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
          {translate('auto.components.armory.ArmoryPage.title', 'Armory')}
        </h1>
        <span className="text-2xs uppercase tracking-wider text-muted-foreground">
          {translate(
            'auto.components.armory.ArmoryPage.subtitle',
            'Integrated tools — runs are scope-checked and audited'
          )}
        </span>
      </header>

      {listError ? (
        <div className="mx-3 mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive md:mx-5">
          {listError}
        </div>
      ) : null}

      <ArmoryScopeBanner scope={scope} onReload={() => setReloadNonce((nonce) => nonce + 1)} />

      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 md:px-5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void runHealth()}
          disabled={healthRunning || tools === null}
        >
          {healthRunning
            ? translate('auto.components.armory.ArmoryPage.checking', 'Checking…')
            : translate('auto.components.armory.ArmoryPage.runHealth', 'Check tool health')}
        </Button>
        {health ? (
          <span className="text-xs text-muted-foreground">
            {translate(
              'auto.components.armory.ArmoryPage.healthSummary',
              '{{healthy}}/{{checkable}} healthy',
              { healthy: String(health.healthy), checkable: String(health.checkable) }
            )}
          </span>
        ) : null}
      </div>
      <ArmoryToolsTable
        tools={tools}
        healthByToolId={
          health ? new Map(health.entries.map((entry) => [entry.toolId, entry])) : null
        }
        onRun={(tool) => {
          setPhase({ kind: 'idle' })
          setRunDialogToolId(tool.id)
        }}
      />

      {runDialogTool ? (
        <ArmoryRunDialog
          tool={runDialogTool}
          running={phase.kind === 'running' && phase.toolId === runDialogTool.id}
          onRun={(targets, args) => void runTool(runDialogTool.id, targets, args)}
          onClose={() => setRunDialogToolId(null)}
        />
      ) : null}

      <ArmoryRunOutput phase={phase} tool={phaseTool} />
    </main>
  )
}
