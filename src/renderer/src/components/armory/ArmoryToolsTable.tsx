import type { ArmoryHealthEntry, ArmoryToolView } from '../../../../shared/armory-contract'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, Play } from 'lucide-react'

const STATUS_BADGE: Record<ArmoryToolView['status'], { label: string; className?: string }> = {
  ok: { label: 'Installed' },
  failed: { label: 'Failed', className: 'border-destructive/50 text-destructive' },
  'quarantined-by-av': {
    label: 'Quarantined',
    className: 'border-destructive/50 text-destructive'
  },
  skipped: { label: 'Skipped' }
}

const HEALTH_DETAIL_STATE: Record<ArmoryHealthEntry['state'], string> = {
  ok: 'bg-emerald-500',
  unhealthy: 'bg-rose-500',
  denied: 'bg-amber-500',
  'spawn-failed': 'bg-rose-500',
  skipped: 'bg-muted-foreground'
}

export function ArmoryToolsTable(props: {
  tools: readonly ArmoryToolView[] | null
  healthByToolId: ReadonlyMap<string, ArmoryHealthEntry> | null
  onRun: (tool: ArmoryToolView) => void
}): React.JSX.Element {
  const { tools, healthByToolId, onRun } = props
  if (tools === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        {translate('auto.components.armory.ArmoryToolsTable.loading', 'Loading inventory…')}
      </div>
    )
  }
  if (tools.length === 0) {
    return (
      <div className="flex flex-1 items-start justify-center px-5 pt-12 text-sm text-muted-foreground">
        {translate(
          'auto.components.armory.ArmoryToolsTable.empty',
          'No integrated tools found in the inventory rings.'
        )}
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 md:px-5 scrollbar-sleek">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
            <th className="px-2 py-2 font-medium">
              {translate('auto.components.armory.ArmoryToolsTable.tool', 'Tool')}
            </th>
            <th className="px-2 py-2 font-medium">
              {translate('auto.components.armory.ArmoryToolsTable.status', 'Status')}
            </th>
            <th className="px-2 py-2 font-medium">
              {translate('auto.components.armory.ArmoryToolsTable.runtime', 'Runtime')}
            </th>
            <th className="px-2 py-2 font-medium">
              {translate('auto.components.armory.ArmoryToolsTable.category', 'Category')}
            </th>
            <th className="px-2 py-2 font-medium">
              {translate('auto.components.armory.ArmoryToolsTable.scopeClass', 'Scope class')}
            </th>
            <th className="px-2 py-2 font-medium">
              {translate('auto.components.armory.ArmoryToolsTable.health', 'Health')}
            </th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => {
            const status = STATUS_BADGE[tool.status]
            const health = healthByToolId?.get(tool.id) ?? null
            const runnable = tool.status === 'ok'
            return (
              <tr key={tool.id} className="border-b border-border/40 last:border-b-0">
                <td className="px-2 py-2">
                  <span className="font-mono text-xs text-foreground">{tool.id}</span>
                  <span
                    className="block max-w-56 truncate font-mono text-2xs text-muted-foreground"
                    title={tool.target}
                  >
                    {tool.target}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <Badge variant="outline" className={status.className}>
                    {translate(
                      `auto.components.armory.ArmoryToolsTable.status.${tool.status}`,
                      status.label
                    )}
                  </Badge>
                </td>
                <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                  {tool.runtime}
                </td>
                <td className="px-2 py-2 text-xs text-muted-foreground">{tool.category}</td>
                <td className="px-2 py-2 text-xs text-muted-foreground">{tool.scopeClass}</td>
                <td className="px-2 py-2">
                  {health ? (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                      title={health.detail}
                    >
                      <span
                        className={cn('size-[7px] rounded-full', HEALTH_DETAIL_STATE[health.state])}
                        aria-hidden
                      />
                      {health.state}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!runnable}
                    onClick={() => onRun(tool)}
                  >
                    <Play className="size-3.5" />
                    {translate('auto.components.armory.ArmoryToolsTable.run', 'Run')}
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
