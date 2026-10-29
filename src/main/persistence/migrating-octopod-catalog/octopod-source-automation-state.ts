import {
  isFinalAutomationRunStatus,
  type Automation,
  type AutomationRun
} from '../../../shared/automations-types'
import { getAutomationRunRepoId } from '../../../shared/automation-run-identity'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import type {
  OctopodMigrationCatalogPayload,
  OctopodMigrationManifestSource
} from '../../../shared/octopod-migration/octopod-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { TaskSourceContext, WorkspaceRunContext } from '../../../shared/task-source-context'
import {
  createOctopodMigrationSourceScope,
  octopodMigrationOwnerMatchesScope,
  octopodMigrationOwnsRepoId,
  type OctopodMigrationSourceScope,
  unqualifyOctopodMigrationOwnerKey
} from './octopod-source-scope'
import { compareKeys } from './octopod-source-key-order'

export type OctopodMigrationSourceAutomationInspection = {
  automations: Automation[]
  automationRuns: AutomationRun[]
  blockedAutomationCount: number
  blockedRunCount: number
  /** Automations held back only by a run still in flight; they move once it finishes. */
  runningAutomationNames: string[]
}

export function collectOctopodMigrationSourceAutomationState(
  state: PersistedState,
  source: OctopodMigrationManifestSource,
  catalog: OctopodMigrationCatalogPayload
): OctopodMigrationSourceAutomationInspection {
  const scope = createOctopodMigrationSourceScope({ source, catalog, repos: state.repos })
  const touchedAutomations = state.automations.filter((entry) =>
    automationTouchesScope(entry, scope)
  )
  const touchedAutomationIds = new Set(touchedAutomations.map((entry) => entry.id))
  const touchedRuns = state.automationRuns.filter(
    (entry) => touchedAutomationIds.has(entry.automationId) || runTouchesScope(entry, scope)
  )
  const runsByAutomationId = Map.groupBy(touchedRuns, (entry) => entry.automationId)
  const automationsById = Map.groupBy(touchedAutomations, (entry) => entry.id)
  const automations: Automation[] = []
  const automationRuns: AutomationRun[] = []
  let blockedAutomationCount = 0
  let blockedRunCount = 0
  const runningAutomationNames: string[] = []

  for (const [automationId, matching] of automationsById) {
    const runs = runsByAutomationId.get(automationId) ?? []
    const transferable =
      matching.length === 1 &&
      automationCanTransfer(matching[0], scope) &&
      runs.every((run) => runContextCanTransfer(run, scope))
    if (!transferable || !runs.every((run) => isFinalAutomationRunStatus(run.status))) {
      if (transferable) {
        runningAutomationNames.push(matching[0].name)
      }
      blockedAutomationCount += matching.length
      blockedRunCount += runs.length
      continue
    }
    automations.push(projectAutomationToDestination(matching[0]))
    automationRuns.push(...runs.map(projectAutomationRunToDestination))
  }

  for (const [automationId, runs] of runsByAutomationId) {
    if (!automationsById.has(automationId)) {
      blockedRunCount += runs.length
    }
  }
  automations.sort((left, right) => compareKeys(left.id, right.id))
  automationRuns.sort((left, right) => compareKeys(left.id, right.id))
  return {
    automations,
    automationRuns,
    blockedAutomationCount,
    blockedRunCount,
    runningAutomationNames: runningAutomationNames.sort(compareKeys)
  }
}

export function automationTouchesScope(
  automation: Automation,
  scope: OctopodMigrationSourceScope
): boolean {
  return (
    (automation.executionTargetType === 'ssh' && automation.executionTargetId === scope.targetId) ||
    // Generations are target-local; another host can share the same number.
    (scope.targetGeneration !== null &&
      automation.executionTargetId === scope.targetId &&
      automation.executionTargetGeneration === scope.targetGeneration) ||
    octopodMigrationOwnsRepoId(scope, getAutomationRunRepoId(automation)) ||
    octopodMigrationOwnerMatchesScope(automation.workspaceId, scope) ||
    contextTouchesScope(automation.runContext, scope) ||
    contextTouchesScope(automation.sourceContext, scope)
  )
}

function runTouchesScope(run: AutomationRun, scope: OctopodMigrationSourceScope): boolean {
  return (
    octopodMigrationOwnerMatchesScope(run.workspaceId, scope) ||
    contextTouchesScope(run.runContext, scope) ||
    contextTouchesScope(run.sourceContext, scope)
  )
}

function automationCanTransfer(automation: Automation, scope: OctopodMigrationSourceScope): boolean {
  return (
    automation.executionTargetType === 'ssh' &&
    automation.executionTargetId === scope.targetId &&
    automation.schedulerOwner === 'ssh_bridge' &&
    (automation.executionTargetGeneration === undefined ||
      automation.executionTargetGeneration === scope.targetGeneration) &&
    scope.repoIds.has(getAutomationRunRepoId(automation)) &&
    ownerCanTransfer(automation.workspaceId, scope) &&
    contextCanTransfer(automation.runContext, scope) &&
    contextCanTransfer(automation.sourceContext, scope)
  )
}

function runContextCanTransfer(run: AutomationRun, scope: OctopodMigrationSourceScope): boolean {
  return (
    ownerCanTransfer(run.workspaceId, scope) &&
    contextCanTransfer(run.runContext, scope) &&
    contextCanTransfer(run.sourceContext, scope)
  )
}

function ownerCanTransfer(value: string | null, scope: OctopodMigrationSourceScope): boolean {
  return value === null || octopodMigrationOwnerMatchesScope(value, scope)
}

function contextTouchesScope(
  context: WorkspaceRunContext | TaskSourceContext | null | undefined,
  scope: OctopodMigrationSourceScope
): boolean {
  return (
    context?.hostId === scope.hostId ||
    (!context?.hostId && octopodMigrationOwnsRepoId(scope, context?.repoId))
  )
}

function contextCanTransfer(
  context: WorkspaceRunContext | TaskSourceContext | null | undefined,
  scope: OctopodMigrationSourceScope
): boolean {
  if (!context) {
    return true
  }
  return (
    context.hostId === scope.hostId &&
    typeof context.repoId === 'string' &&
    scope.repoIds.has(context.repoId) &&
    (!context.projectHostSetupId || context.projectHostSetupId === context.repoId)
  )
}

function projectAutomationToDestination(source: Automation): Automation {
  const destination: Automation = {
    ...structuredClone(source),
    runContext: projectContextToDestination(source.runContext),
    sourceContext: projectContextToDestination(source.sourceContext),
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'remote_host_service',
    // Servers accept only dormant rows; the desktop re-enables moved ones after commit.
    enabled: false,
    workspaceId: projectOwnerToDestination(source.workspaceId)
  }
  delete destination.executionTargetGeneration
  return destination
}

function projectAutomationRunToDestination(source: AutomationRun): AutomationRun {
  return {
    ...structuredClone(source),
    runContext: projectContextToDestination(source.runContext),
    sourceContext: projectContextToDestination(source.sourceContext),
    workspaceId: projectOwnerToDestination(source.workspaceId)
  }
}

function projectContextToDestination<T extends WorkspaceRunContext | TaskSourceContext>(
  context: T | null | undefined
): T | null {
  if (!context) {
    return null
  }
  return Object.assign(structuredClone(context), {
    hostId: LOCAL_EXECUTION_HOST_ID,
    projectHostSetupId: context.repoId ?? null
  })
}

function projectOwnerToDestination(value: string | null): string | null {
  return value === null ? null : unqualifyOctopodMigrationOwnerKey(value)
}
