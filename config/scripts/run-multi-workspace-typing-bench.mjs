// Run pnpm bench:multi-workspace-typing -- --panes 8 --rate-kbps 512 --keys 48 --label before-fix (see terminal-multi-workspace-typing-latency.spec.ts).
// Save distinct labels per build/config in tests/tools/benchmarks/results/multi-workspace-typing-*.json; compare totalMs/inputHalfMs/echoHalfMs percentiles.
import { spawn } from 'node:child_process'

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const knobByFlag = {
  '--visited-workspaces': 'OSHIELD_TYPING_BENCH_VISITED_WORKSPACES',
  '--load-workspaces': 'OSHIELD_TYPING_BENCH_LOAD_WORKSPACES',
  '--panes': 'OSHIELD_TYPING_BENCH_LOAD_PANES',
  '--rate-kbps': 'OSHIELD_TYPING_BENCH_RATE_KBPS',
  '--keys': 'OSHIELD_TYPING_BENCH_KEYS',
  '--cadence-ms': 'OSHIELD_TYPING_BENCH_KEY_CADENCE_MS',
  '--cpu-workers': 'OSHIELD_TYPING_BENCH_CPU_WORKERS',
  '--git-churn-repos': 'OSHIELD_TYPING_BENCH_GIT_CHURN_REPOS',
  '--git-churn-files': 'OSHIELD_TYPING_BENCH_GIT_CHURN_FILES',
  '--git-churn-concurrency': 'OSHIELD_TYPING_BENCH_GIT_CHURN_CONCURRENCY',
  '--codex-frame-rows': 'OSHIELD_TYPING_BENCH_CODEX_FRAME_ROWS',
  '--codex-split-delay-ms': 'OSHIELD_TYPING_BENCH_CODEX_SPLIT_DELAY_MS',
  '--worktrees': 'OSHIELD_TYPING_BENCH_METADATA_WORKTREES',
  '--repositories': 'OSHIELD_TYPING_BENCH_METADATA_REPOSITORIES',
  '--terminal-tabs': 'OSHIELD_TYPING_BENCH_METADATA_TERMINAL_TABS',
  '--unified-tabs': 'OSHIELD_TYPING_BENCH_METADATA_UNIFIED_TABS',
  '--sleepers': 'OSHIELD_TYPING_BENCH_METADATA_SLEEPERS',
  '--live-statuses': 'OSHIELD_TYPING_BENCH_METADATA_LIVE_STATUSES',
  '--panes-per-tab': 'OSHIELD_TYPING_BENCH_METADATA_PANES',
  '--status-history': 'OSHIELD_TYPING_BENCH_METADATA_STATUS_HISTORY',
  '--status-interval-ms': 'OSHIELD_TYPING_BENCH_METADATA_STATUS_INTERVAL_MS',
  '--agent-rows': 'OSHIELD_TYPING_BENCH_AGENT_ROWS',
  '--title-change-ms': 'OSHIELD_TYPING_BENCH_TITLE_CHANGE_MS',
  '--lifecycle-ms': 'OSHIELD_TYPING_BENCH_LIFECYCLE_MS',
  '--cpu-profile': 'OSHIELD_TYPING_BENCH_CPU_PROFILE',
  '--pty-metadata': 'OSHIELD_TYPING_BENCH_PTY_METADATA',
  '--metadata-status': 'OSHIELD_TYPING_BENCH_METADATA_STATUS',
  '--metadata-titles': 'OSHIELD_TYPING_BENCH_METADATA_TITLES',
  '--instrumentation': 'OSHIELD_TYPING_BENCH_INSTRUMENTATION',
  '--graph-probe': 'OSHIELD_TYPING_BENCH_GRAPH_PROBE',
  '--cpu-throttle': 'OSHIELD_TYPING_BENCH_CPU_THROTTLE',
  '--label': 'OSHIELD_TYPING_BENCH_LABEL'
}

const env = { ...process.env, OSHIELD_BACKGROUND_LAUNCH: '1', OSHIELD_TYPING_BENCH: '1' }
const passthroughArgs = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--') {
    continue
  }
  const knob = knobByFlag[argv[i]]
  if (knob) {
    env[knob] = argv[++i]
  } else {
    passthroughArgs.push(argv[i])
  }
}

const child = spawn(
  npxCommand,
  [
    'playwright',
    'test',
    'tests/e2e/terminal-multi-workspace-typing-latency.spec.ts',
    '--config',
    'tests/playwright.config.ts',
    '--project',
    'electron-headless',
    '--workers=1',
    ...passthroughArgs
  ],
  { stdio: 'inherit', env }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
