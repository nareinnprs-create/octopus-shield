import type { ArmoryToolView } from '../../../../shared/armory-contract'
import { translate } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'
import type { ArmoryRunPhase } from './ArmoryPage'

const outputSection = (heading: string, body: string): React.JSX.Element | null =>
  body.length === 0 ? null : (
    <section className="min-w-0">
      <h4 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {heading}
      </h4>
      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-editor-surface p-2 font-mono text-xs whitespace-pre-wrap break-words text-foreground scrollbar-sleek">
        {body}
      </pre>
    </section>
  )

export function ArmoryRunOutput(props: {
  phase: ArmoryRunPhase
  tool: ArmoryToolView | null
}): React.JSX.Element {
  const { phase, tool } = props
  if (phase.kind === 'idle' || tool === null) {
    return <div className="shrink-0" />
  }
  return (
    <section className="shrink-0 border-t border-border px-3 py-3 md:px-5">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-mono text-xs text-foreground">{tool.id}</h3>
        {phase.kind === 'running' ? (
          <Badge variant="secondary">
            {translate('auto.components.armory.ArmoryRunOutput.running', 'Running')}
          </Badge>
        ) : null}
        {phase.kind === 'denied' ? (
          <Badge variant="destructive">
            {translate('auto.components.armory.ArmoryRunOutput.denied', 'DENIED')}
          </Badge>
        ) : null}
        {phase.kind === 'done' ? (
          <Badge variant="outline">
            {phase.outcome.record.timedOut
              ? translate('auto.components.armory.ArmoryRunOutput.timeout', 'Timed out')
              : translate('auto.components.armory.ArmoryRunOutput.exit', 'exit {{code}}', {
                  code: String(phase.outcome.record.exitCode ?? 'null')
                })}
          </Badge>
        ) : null}
      </div>

      {phase.kind === 'denied' ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 font-mono text-xs break-words text-destructive">
          {phase.reason}
        </p>
      ) : null}

      {phase.kind === 'done' ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {translate('auto.components.armory.ArmoryRunOutput.duration', 'Duration')}
              {': '}
              <span className="font-mono text-foreground">{phase.outcome.record.durationMs}ms</span>
            </span>
            <span
              className="min-w-0 truncate font-mono"
              title={phase.outcome.record.argv.join(' ')}
            >
              {phase.outcome.record.argv.join(' ')}
            </span>
          </div>
          {outputSection(
            translate('auto.components.armory.ArmoryRunOutput.stdout', 'stdout'),
            phase.outcome.record.stdout
          )}
          {outputSection(
            translate('auto.components.armory.ArmoryRunOutput.stderr', 'stderr'),
            phase.outcome.record.stderr
          )}
          <section className="min-w-0">
            <h4 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              {translate('auto.components.armory.ArmoryRunOutput.auditEvent', 'Audit event')}
            </h4>
            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-editor-surface p-2 font-mono text-xs text-muted-foreground scrollbar-sleek">
              {JSON.stringify(phase.outcome.auditEvent, null, 2)}
            </pre>
          </section>
        </div>
      ) : null}
    </section>
  )
}
