import type {
  ArmoryScopeState,
  ArmorySetupItem,
  ArmorySetupState
} from '../../../../shared/armory-contract'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'

const describeScope = (scope: ArmoryScopeState): string =>
  [...scope.targets, ...scope.cidrs].join(', ')

const SetupChecklist = ({ items }: { items: readonly ArmorySetupItem[] }): React.JSX.Element => {
  const failing = items.filter((item) => !item.ok)
  if (failing.length === 0) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/50 text-emerald-600 dark:text-emerald-400"
      >
        {translate('auto.components.armory.ArmoryScopeBanner.setupReady', 'Environment ready')}
      </Badge>
    )
  }
  return (
    <span className="truncate font-mono text-xs text-amber-600 dark:text-amber-400">
      {translate('auto.components.armory.ArmoryScopeBanner.setupPending', 'Setup:')}{' '}
      {failing
        .map((item) => `${item.id} — ${item.detail}${item.hint ? ` (${item.hint})` : ''}`)
        .join(' · ')}
    </span>
  )
}

export function ArmoryScopeBanner(props: {
  scope: ArmoryScopeState | null
  setup?: ArmorySetupState | null
  onReload: () => void
}): React.JSX.Element {
  const { scope, setup, onReload } = props
  if (scope === null) {
    return <div className="h-7 shrink-0" />
  }
  const summary = describeScope(scope)
  return (
    <div className="flex shrink-0 items-center gap-2 px-3 pb-2 md:px-5">
      <Badge
        variant={scope.authorized ? 'secondary' : 'outline'}
        className={cn(!scope.authorized && 'border-destructive/50 text-destructive')}
      >
        {scope.authorized
          ? translate('auto.components.armory.ArmoryScopeBanner.authorized', 'Scope authorized')
          : translate('auto.components.armory.ArmoryScopeBanner.unauthorized', 'No scope')}
      </Badge>
      <span className="truncate font-mono text-xs text-muted-foreground" title={summary}>
        {scope.authorized
          ? summary
          : translate(
              'auto.components.armory.ArmoryScopeBanner.empty',
              'Set OSHIELD_ARMORY_SCOPE to authorize targets'
            )}
      </span>
      {scope.exploitAuthorized ? (
        <Badge variant="outline" className="border-amber-600/50 text-amber-700 dark:text-amber-400">
          {translate(
            'auto.components.armory.ArmoryScopeBanner.exploitAuthorized',
            'Exploit-class authorized'
          )}
        </Badge>
      ) : null}
      {setup ? (
        <span className={cn('truncate font-mono text-xs')}>
          <SetupChecklist items={setup.items} />
        </span>
      ) : null}
      <button
        type="button"
        onClick={onReload}
        className="ml-auto shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {translate('auto.components.armory.ArmoryScopeBanner.reload', 'Reload')}
      </button>
    </div>
  )
}
