// Compose the Node-host runtime; paired desktop pages work even without a local browser engine.
import process from 'node:process'
import { getAppEnvironment } from '../../shared/app-environment'
import { resolveOctopodInstallRoot, resolveUserDataPath } from './octopod-app-paths'
import { prepareOctopodCliLauncher } from './octopod-cli-launcher'
import { installOctopodHostAdapters, runOctopodQuitHandlers } from './octopod-host-adapters'
import { prepareOctopodSecretStoreAndMigrate } from './octopod-secret-store-startup'
import { describeOctopodBindExposure, resolveOctopodBindHost } from './octopod-bind-address'
import {
  flushOctopodProfileStoreForShutdown,
  installOctopodShutdownSignals,
  startOctopodWithHost,
  stopOctopodStructuredAgentSessions,
  type OctopodShutdownTrigger
} from './octopod-lifecycle'
import { OCTOPOD_USAGE, parseArgs, resolveOctopodWebClientRoot } from './octopod-command-arguments'
import type { OctopodRuntimeCleanup } from './octopod-runtime-lifetime'
import { installOctopodStopRequestListeners } from './octopod-stop-request-listener'
import { prepareOctopodManagedStop } from './octopod-managed-stop-admission'
import { bindOctopodStopTerminalAdmission } from './octopod-stop-terminal-admission'
import type { OctopodHandle, OctopodOptions } from './octopod-start-contract'
import { beginOctopodIdleExit, bindOctopodIdleShutdown } from './octopod-managed-idle-exit-host'
import { octopodAutomationsKeepHostBusy, startOctopodAutomations } from './octopod-automations'
import { changedAiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import type { AiVaultSearchSettings } from '../../shared/ai-vault-search-settings'
import { stampRuntimeSourceEnv } from '../../shared/runtime-source-env'
import { adoptWslHostLoginEnvironment } from './octopod-wsl-host-login-environment'
import { installOctopodProcessErrorGuards } from './octopod-process-error-guards'
import { octopodWsPortOptions } from './octopod-ws-port-policy'
import { OSHIELD_LAYOUT_OWNER_IS_MAIN } from '../../shared/layout-owner-switch'
import { placeUnshownLiveTerminalsBestEffort } from '../runtime/terminal/adoption/unshown-live-terminal-placement'

export { parseArgs }

let closeOctopodObservability = (): void => {}

/** Resolve after transport readiness publishes the desktop-compatible serve payload. */
export async function startOctopod(options: OctopodOptions = {}): Promise<OctopodHandle> {
  installOctopodHostAdapters()
  // Inherited terminal identity must not fence octopod’s CLI children to the launching desktop.
  stampRuntimeSourceEnv(process.env, null)
  const userDataPath = resolveUserDataPath()
  // Override inherited data roots so CLI-shared Codex homes resolve on this host.
  process.env.OSHIELD_USER_DATA_PATH = userDataPath
  const { readiness, instance, stop } = await startOctopodWithHost(
    userDataPath,
    (registerCleanup) => startOctopodRuntime(options, registerCleanup),
    () => {
      try {
        runOctopodQuitHandlers()
      } finally {
        // Close after quit handlers, including failed ones, so their spans reach disk.
        closeOctopodObservability()
        closeOctopodObservability = () => {}
      }
    }
  )
  const version = getAppEnvironment().getVersion()
  return { readiness, managedStop: { version, runtimeId: readiness.runtimeId, instance }, stop }
}

async function startOctopodRuntime(
  options: OctopodOptions,
  registerCleanup: (cleanup: OctopodRuntimeCleanup) => void
): Promise<Pick<OctopodHandle, 'readiness'>> {
  // Overlap login-shell probing with imports and store startup.
  const loginEnvironment = adoptWslHostLoginEnvironment().then(
    (names) => {
      if (names.length > 0) {
        console.info(`[octopod] adopted login-shell variables: ${names.join(', ')}`)
      }
    },
    (error: unknown) => console.warn('[octopod] could not adopt login-shell variables:', error)
  )
  const { ShieldRuntimeService } = await import('../runtime/shield-runtime')
  const { ShieldRuntimeRpcServer } = await import('../runtime/runtime-rpc')
  const { registerHeadlessPtyRuntime } = await import('../ipc/pty/register-headless-runtime')
  const { getLocalPtyProvider } = await import('../ipc/pty/provider/registry')
  const { installOctopodObservability } = await import('./octopod-observability')
  closeOctopodObservability = installOctopodObservability()
  const { ServeReadinessPublisher } = await import('../server/serve-readiness')
  const { servePublishMode } = await import('../server/serve-pairing-readiness')
  const { buildOctopodServeReadiness } = await import('./octopod-serve-readiness')
  const { createOctopodProfileStateStartup } = await import('./octopod-profile-state-startup')
  const { startOctopodDaemon, stopOctopodDaemon } = await import('./octopod-daemon-supervision')
  const { daemonOwnsFreshPersistentPtys } = await import('../daemon/daemon-provider-state')
  const { collectOctopodHealth } = await import('./octopod-health')
  const { agentHookServer } = await import('../agent-hooks/server')
  const { isAgentStatusHooksEnabled } = await import('../agent-hooks/managed-agent-hook-controls')
  const { agentHookRuntimeDeps } = await import('../agent-hooks/agent-hook-runtime-deps')
  const { installHookStatusSessionTabsRepublish } =
    await import('../agent-hooks/hook-status-session-tabs-republish')
  const { startOctopodManagedAgentHooks } = await import('./octopod-managed-agent-hooks')
  const { AgentStatusObservedPaneIdentities, AgentStatusObservedPaneIdentityCapture } =
    await import('../runtime/agent-status-observed-pane-identity')

  const { disposeWatcherProcessAndWait } =
    await import('../ipc/filesystem/watcher-process/parcel-watcher-process')

  let paneGridsForShutdown: { flushPaneGrids(): Promise<void> | null } | null = null
  let profileStoreForShutdown:
    | { flushFinalOrThrowAsync(): Promise<void>; freezeWritesAsync(): Promise<void> }
    | undefined
  let uninstallHookStatusRepublish = (): void => {}
  let uninstallObservedStatusIdentity = (): void => {}
  // Cleanups run in reverse: RPC, then recovery and watchers, then the final flush, then daemon.
  registerCleanup(() => agentHookServer.stop())
  registerCleanup(() => uninstallHookStatusRepublish())
  registerCleanup(() => uninstallObservedStatusIdentity())
  // Disconnect without killing daemon PTYs that must survive restart.
  registerCleanup(() => stopOctopodDaemon())
  registerCleanup(async () => {
    // A SQLite-backed octopod has no JSON mirror to absorb a debounced write after SIGTERM.
    if (profileStoreForShutdown) {
      await flushOctopodProfileStoreForShutdown(profileStoreForShutdown, paneGridsForShutdown)
    }
  })
  registerCleanup(stopOctopodStructuredAgentSessions)
  registerCleanup(() => disposeWatcherProcessAndWait())
  const { DesktopPushService } = await import('../runtime/push/desktop-push-service')
  const { resolvePushGatewayOrigin } = await import('../runtime/push/push-gateway-origin')

  const runtimeUserDataPath = getAppEnvironment().getPath('userData')
  const { startEventLoopDelayProbe } = await import('../diagnostics/event-loop-delay-probe')
  startEventLoopDelayProbe('octopod', runtimeUserDataPath)
  await prepareOctopodCliLauncher().catch((error: unknown) => {
    console.warn('[octopod] Could not prepare the profile CLI launcher', error)
  })
  const idleExitStartup = beginOctopodIdleExit(runtimeUserDataPath)
  const { octopodSessionScannerIdleTimeoutMs } = await import('./octopod-session-scanner-idle')
  const scannerIdleTimeoutMs = octopodSessionScannerIdleTimeoutMs()
  if (scannerIdleTimeoutMs !== null) {
    const { setAiVaultServiceIdleTimeoutMs } =
      await import('../ai-vault/session-scanner-service-spawn')
    setAiVaultServiceIdleTimeoutMs(scannerIdleTimeoutMs)
  }
  // Initialize sealing before Store load unseals protected settings.
  await prepareOctopodSecretStoreAndMigrate(runtimeUserDataPath)
  const { store: profileStore, authority: profileStateAuthority } =
    await createOctopodProfileStateStartup(runtimeUserDataPath)
  const observedPaneIdentities = new AgentStatusObservedPaneIdentities()
  const observedStatusCapture = new AgentStatusObservedPaneIdentityCapture(observedPaneIdentities)
  profileStoreForShutdown = profileStore
  uninstallObservedStatusIdentity = agentHookServer.subscribeEnrichedStatus((enriched) =>
    observedStatusCapture.observe(enriched)
  )
  // Subscribe before hooks start so early turns are counted.
  const { startOctopodStats } = await import('./octopod-stats')
  const stats = startOctopodStats(runtimeUserDataPath, agentHookServer, registerCleanup)
  await agentHookServer.start({
    env: 'production',
    userDataPath: runtimeUserDataPath,
    statusHooksEnabled: isAgentStatusHooksEnabled(profileStore.getSettings())
  })

  // Reconcile, daemon and runtime all consume this environment.
  await loginEnvironment
  startOctopodManagedAgentHooks(
    profileStore,
    (enabled) => agentHookServer.setStatusHooksEnabled(enabled),
    registerCleanup
  )

  // Install the daemon provider before PTY handlers can route their first call.
  await startOctopodDaemon()

  // Runtime constructor callbacks use this index only after it is installed.
  let sessionSearch: { apply(settings: AiVaultSearchSettings): void; dispose(): void } | null = null

  const { octopodCodexAccountHomes } = await import('./octopod-codex-account-homes')
  const codexAccountHomes = octopodCodexAccountHomes(
    () => profileStore.getSettings(),
    registerCleanup
  )

  const { createOctopodAccountServices } = await import('./octopod-account-services')
  const accountLaunch = createOctopodAccountServices({
    store: profileStore,
    setClaudeStatusLineListener: (listener) =>
      agentHookServer.setClaudeStatusLineListener(listener),
    registerCleanup,
    clientCodexHomes: codexAccountHomes
  })

  const { octopodAiVaultSessionSources, installOctopodSessionSearchService } =
    await import('./octopod-session-search')
  const { loadAgentSessionClaimSigner } =
    await import('../runtime/agent-session/ownership/agent-session-claim-identity')
  const runtime = new ShieldRuntimeService(profileStore, stats, {
    // Persistent signatures let restarted runtimes adopt PTYs owned before restart.
    agentSessionClaimSigner: loadAgentSessionClaimSigner(runtimeUserDataPath, runtimeUserDataPath),
    ...octopodAiVaultSessionSources(profileStore, codexAccountHomes, accountLaunch),
    // Why absent on a WSL host: a resolver overrides the desktop-pushed CODEX_HOME.
    ...accountLaunch?.runtimeDeps,
    ...agentHookRuntimeDeps(agentHookServer, observedPaneIdentities, () =>
      profileStore.getSettings()
    ),
    // Resolve lazily because daemon swaps replace the provider after construction.
    getLocalProvider: () => getLocalPtyProvider(),
    // Read current daemon ownership; failed/degraded launch cannot claim fresh PTY persistence.
    canRecoverPersistentLocalPtys: () => daemonOwnsFreshPersistentPtys(),
    // Node hosts cannot promote into desktop windows; override the constructor’s openable default.
    getDesktopWindowStatus: () => 'blocked',
    // Unchanged settings would reconstruct a healthy search index; deduplicate before apply.
    applySessionSearchSettings: (before, after) => {
      const next = changedAiVaultSearchSettings(before, after)
      if (next) {
        sessionSearch?.apply(next)
      }
    }
  })
  paneGridsForShutdown = runtime

  accountLaunch?.attachToRuntime(runtime)
  const { installOctopodEmulatorBridge } = await import('./octopod-emulator-bridge')
  installOctopodEmulatorBridge(runtime, registerCleanup)

  // Restore prior desktop-pushed account selection before automations or CLI launches.
  const { restoreOctopodHostAccountLaunchEnv } = await import('./octopod-host-account-launch-env-store')
  restoreOctopodHostAccountLaunchEnv(runtime, runtimeUserDataPath)

  sessionSearch = await installOctopodSessionSearchService({
    userDataPath: runtimeUserDataPath,
    getSettings: () => profileStore.getSettings()
  })
  getAppEnvironment().onWillQuit(() => sessionSearch?.dispose())

  const { startAgentStateRulesLiveUpdates } =
    await import('../runtime/agent-state-rules/agent-state-rules-live-update')
  startAgentStateRulesLiveUpdates(profileStore, (rules) =>
    console.info(`[octopod] agent state rules ${rules.version} (${rules.source})`)
  )
  if (OSHIELD_LAYOUT_OWNER_IS_MAIN) {
    const { repairDuplicatePtyPanesOnStart } = await import('../runtime/moved-pane-owner-rekey')
    // Wait behind earlier writes and persist repair before reconciliation/RPC admission.
    await repairDuplicatePtyPanesOnStart(profileStore, runtime)
  }

  // Status changes must republish session.tabs to paired clients.
  uninstallHookStatusRepublish = installHookStatusSessionTabsRepublish(
    agentHookServer,
    () => runtime
  )
  registerCleanup(runtime.attachAgentStatusStore(agentHookServer))

  // Headless registration threads Store into persistence; account homes prefer client then host selection.
  // WSL has no host selection and keeps the desktop-prepared environment.
  await registerHeadlessPtyRuntime(
    runtime,
    async (target, launchEnv, context) =>
      (await codexAccountHomes.selectLaunchHome(target, launchEnv, context)) ??
      (accountLaunch ? accountLaunch.prepareCodexHome(target, launchEnv, context) : null),
    () => profileStore.getSettings(),
    accountLaunch?.prepareClaudeAuth,
    profileStore,
    accountLaunch?.prepareCodexSessionResume
  )

  // Recover browser/orchestration authority before clients attach to the runtime graph.
  runtime.rehydrateClientHostedBrowserPages()

  await runtime.refreshRestoredOrchestrationAuthority()
  await runtime.reconcileLegacyWorkerTerminals()
  if (OSHIELD_LAYOUT_OWNER_IS_MAIN) {
    await placeUnshownLiveTerminalsBestEffort(runtime)
  }
  runtime.agentTransitions.seedRestoredRows()
  void runtime.sidebarFacts?.reconcileSortStampTiers(getLocalPtyProvider())

  // Run after RPC stops; later dismissal records save synchronously until exit.
  registerCleanup(() => runtime.closeNotificationDismissals())
  // Stop recovery retries before final profile flush.
  registerCleanup(() => runtime.stopLegacyWorkerTerminalRecovery())

  // Recovery establishes terminal/dispatch identities before fencing observations.
  observedStatusCapture.attach(runtime)
  agentHookServer.setCliWriterExecutionMatcher(observedPaneIdentities, runtime)
  // First RPC clients must see a fully published graph.
  const { publishHeadlessRuntimeGraph } = await import('../runtime/headless-runtime-graph')
  publishHeadlessRuntimeGraph(runtime)
  // Only the runtime can identify running shells and install deferred migrated history.
  void runtime.installPendingOctopodMigrationShellHistory().catch((error: unknown) => {
    console.error('[octopod-migration] installing pending shell history failed:', error)
  })

  const bindHost = resolveOctopodBindHost(options.bind)
  bindOctopodStopTerminalAdmission(runtime.terminalUpdateAdmission)
  const rpc = new ShieldRuntimeRpcServer({
    runtime,
    userDataPath: runtimeUserDataPath,
    enableWebSocket: true,
    // Pin operator exposure across restarts; pairing must not silently widen a loopback bind.
    pinnedBindHost: bindHost,
    webClientRoot: resolveOctopodWebClientRoot(options.webClientRoot),
    ...octopodWsPortOptions(options.port)
  })
  // Stop RPC before cleanup can tear down writers and runtime state.
  registerCleanup(() => rpc.stop())
  await rpc.start()
  startOctopodAutomations(runtime, profileStore, registerCleanup)
  const pushService = DesktopPushService.create({
    runtime,
    runtimeRpc: rpc,
    gatewayUrl: resolvePushGatewayOrigin(process.env, getAppEnvironment().isPackaged())
  })
  pushService?.start()
  getAppEnvironment().onWillQuit(() => pushService?.stop())
  console.error(`[octopod] ${describeOctopodBindExposure(bindHost)}`)

  const readiness = await buildOctopodServeReadiness({
    options,
    runtimeId: runtime.getRuntimeId(),
    rpc,
    collectHealth: () =>
      collectOctopodHealth(
        getAppEnvironment().getVersion(),
        profileStateAuthority,
        idleExitStartup.previousIdleStop
      )
  })

  await new ServeReadinessPublisher().publish(readiness, servePublishMode(options))

  await idleExitStartup.start({
    rpc,
    agentStates: () => agentHookServer.getStatusSnapshot(),
    hasStagedMigration: () => profileStore.hasStagedOctopodMigrationCatalog(),
    automationsBusy: () => octopodAutomationsKeepHostBusy(profileStore),
    emulatorsBusy: async () =>
      (await runtime.getEmulatorBridge()?.hasLiveManagedSessions()) ?? false,
    registerCleanup
  })
  return { readiness }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(OCTOPOD_USAGE)
    return
  }
  let shutdownTrigger: OctopodShutdownTrigger | null = null
  // Fire-and-forget startup work can reject before its first await completes.
  installOctopodProcessErrorGuards(() => shutdownTrigger)
  const startup = startOctopod(options)
  const requestShutdown = installOctopodShutdownSignals(async () => (await startup).stop())
  shutdownTrigger = requestShutdown
  const handle = await startup
  // Stop requests must name the runtime/instance established by startup.
  installOctopodStopRequestListeners(() => requestShutdown('stop request'), {
    installRoot: resolveOctopodInstallRoot(),
    managedStop: handle.managedStop,
    beforeManagedStop: prepareOctopodManagedStop
  })
  bindOctopodIdleShutdown(requestShutdown)
}
