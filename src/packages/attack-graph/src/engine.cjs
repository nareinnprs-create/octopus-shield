'use strict'
// X1 increment CLI: goal -> ATT&CK phase plan over the armory ring catalog.
// Default is dry-run. --execute is triple-gated (HR2): explicit consent flag +
// OSHIELD_ARMORY_SCOPE env; commands are only PRINTED unless --run is also
// given. --run shells out to the armory CLI per task, sequentially; a
// non-zero exit stops the chain.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { parseGoal } = require('./goal.cjs')
const { planTasks } = require('./planner.cjs')

const USAGE = `usage: node engine.cjs --goal <goal> --rings-dir <dir> [--scope <cidr>] [--out <file>]
       [--dry-run] | [--execute [--i-accept-authorized-targets] [--run] [--armory-cli <cmd>]]`

function parseArgs(argv, env) {
  const flags = {
    goal: null,
    ringsDir: null,
    scope: null,
    out: null,
    execute: false,
    run: false,
    iAccept: false,
    armoryCli: 'armory',
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      if (argv[i + 1] === undefined) throw new Error(`missing value for ${arg}`)
      return argv[++i]
    }
    switch (arg) {
      case '--goal': flags.goal = next(); break
      case '--rings-dir': flags.ringsDir = next(); break
      case '--scope': flags.scope = next(); break
      case '--out': flags.out = next(); break
      case '--execute': flags.execute = true; break
      case '--run': flags.run = true; break
      case '--i-accept-authorized-targets': flags.iAccept = true; break
      case '--armory-cli': flags.armoryCli = next(); break
      case '--dry-run': break
      default: throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (!flags.goal) throw new Error('--goal is required')
  if (!flags.ringsDir) throw new Error('--rings-dir is required')
  flags.ringsDir = path.resolve(flags.ringsDir)
  flags.envScope = env.OSHIELD_ARMORY_SCOPE ?? null
  return flags
}

// Rings dir holds *.json arrays of { id, runtime, status }; malformed files or
// entries are skipped, not fatal (same tolerance as toolring-mcp).
function loadRingTools(ringsDir) {
  const tools = []
  let files
  try {
    files = fs.readdirSync(ringsDir)
  } catch {
    return tools
  }
  for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
    let entries
    try {
      entries = JSON.parse(fs.readFileSync(path.join(ringsDir, file), 'utf8'))
    } catch {
      continue
    }
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) continue
      tools.push({ id: entry.id, runtime: entry.runtime ?? null, status: entry.status ?? null })
    }
  }
  return tools
}

function commandFor(task, targets, armoryCli) {
  const argv = ['run', task.tool]
  if (targets) argv.push(`--targets=${targets}`)
  argv.push('--', ...task.argv)
  return `${armoryCli} ${argv.join(' ')}`
}

function gateExecute(flags, err) {
  if (!flags.iAccept) {
    err('refuse: --execute requires --i-accept-authorized-targets (explicit authorization, HR2)')
    return 2
  }
  if (!flags.envScope) {
    err('refuse: --execute requires OSHIELD_ARMORY_SCOPE to be set (authorized target scope)')
    return 2
  }
  return 0
}

function main(argv, env, out, err) {
  let flags
  try {
    flags = parseArgs(argv, env)
  } catch (error) {
    err(`attack-graph: ${error.message}\n${USAGE}`)
    return 2
  }

  const plan = parseGoal(flags.goal)
  const tools = loadRingTools(flags.ringsDir)
  const result = planTasks({ plan, tools, scope: flags.scope })
  const targets = flags.scope ?? flags.envScope ?? ''
  result.mode = flags.execute ? (flags.run ? 'run' : 'print') : 'dry-run'
  result.generatedAt = new Date().toISOString()

  if (flags.execute) {
    const refusal = gateExecute(flags, err)
    if (refusal !== 0) return refusal
    for (const phase of result.phases) {
      for (const task of phase.tasks) {
        const command = commandFor(task, targets, flags.armoryCli)
        if (result.mode === 'print') {
          // stdout stays machine-readable: command echoes go to stderr
          err(`[print-only] ${command}`)
          continue
        }
        // shortcut: task.argv are unvetted planning placeholders, not vetted tool syntax — upgrade before trusted --run use
        const run = spawnSync(flags.armoryCli, command.split(' ').slice(1), { stdio: 'inherit' })
        const code = run.status ?? 1
        err(`attack-graph: ${task.tool} (${task.technique}) exit=${code}`)
        if (code !== 0) {
          err(`attack-graph: chain stopped at ${phase.id}/${task.tool}`)
          return code
        }
      }
    }
  }

  const json = JSON.stringify(result, null, 2)
  if (flags.out) {
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true })
    fs.writeFileSync(flags.out, `${json}\n`)
  }
  out(json)
  return 0
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), process.env, (l) => process.stdout.write(`${l}\n`), (l) => process.stderr.write(`${l}\n`))
}

module.exports = { main, parseArgs, loadRingTools, commandFor }
