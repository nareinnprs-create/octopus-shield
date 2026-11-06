'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { main, loadRingTools, commandFor } = require('./engine.cjs')

const ENGINE = path.join(__dirname, 'engine.cjs')

function tempRingsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attack-graph-'))
  fs.writeFileSync(path.join(dir, 'windows.json'), JSON.stringify([{ id: 'nmap', runtime: 'win', status: 'ok' }]))
  fs.writeFileSync(path.join(dir, 'broken.json'), '{nope')
  return dir
}

function runCli(args, env = {}) {
  const res = spawnSync(process.execPath, [ENGINE, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

test('dry-run is the default and prints the phased plan JSON', () => {
  const res = runCli(['--goal', 'domain_admin', '--rings-dir', tempRingsDir()])
  assert.equal(res.code, 0)
  const plan = JSON.parse(res.stdout)
  assert.equal(plan.mode, 'dry-run')
  assert.equal(plan.goal, 'domain_admin')
  assert.deepEqual(plan.phases.map((p) => p.id), ['recon', 'enumerate', 'exploit', 'post-exploit', 'objective'])
  assert.ok(plan.summary.tasks > 0)
  for (const phase of plan.phases) assert.ok(Array.isArray(phase.tasks) && Array.isArray(phase.missing))
})

test('--out writes the same plan JSON to disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attack-graph-out-'))
  const out = path.join(dir, 'plan.json')
  const res = runCli(['--goal', 'web_shell', '--rings-dir', tempRingsDir(), '--out', out])
  assert.equal(res.code, 0)
  const written = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.equal(written.goal, 'web_shell')
  assert.equal(written.mode, 'dry-run')
})

test('--execute is refused without --i-accept-authorized-targets', () => {
  const res = runCli(['--goal', 'domain_admin', '--rings-dir', tempRingsDir(), '--execute'], { OSHIELD_ARMORY_SCOPE: '10.0.0.0/24' })
  assert.equal(res.code, 2)
  assert.match(res.stderr, /refuse: --execute requires --i-accept-authorized-targets/)
  assert.equal(res.stdout, '')
})

test('--execute is refused without OSHIELD_ARMORY_SCOPE', () => {
  const res = runCli(['--goal', 'domain_admin', '--rings-dir', tempRingsDir(), '--execute', '--i-accept-authorized-targets'])
  assert.equal(res.code, 2)
  assert.match(res.stderr, /refuse: --execute requires OSHIELD_ARMORY_SCOPE/)
})

test('gated execute with consent+scope but no --run prints commands instead of running', () => {
  const res = runCli(
    ['--goal', 'domain_admin', '--rings-dir', tempRingsDir(), '--execute', '--i-accept-authorized-targets', '--scope', '10.0.0.0/24'],
    { OSHIELD_ARMORY_SCOPE: '10.0.0.0/24' }
  )
  assert.equal(res.code, 0)
  const plan = JSON.parse(res.stdout)
  assert.equal(plan.mode, 'print')
  const commandLines = res.stderr.trim().split('\n').filter((l) => l.startsWith('[print-only]'))
  assert.equal(commandLines.length, plan.summary.tasks)
  assert.ok(commandLines.every((l) => l.includes('run nmap --targets=10.0.0.0/24 --')))
})

test('missing --goal or --rings-dir exits 2 with usage', () => {
  assert.equal(runCli(['--goal', 'x']).code, 2)
  assert.equal(runCli(['--rings-dir', '.']).code, 2)
  assert.equal(runCli(['--bogus']).code, 2)
})

test('loadRingTools tolerates broken json and missing dirs', () => {
  const dir = tempRingsDir()
  assert.deepEqual(loadRingTools(dir).map((t) => t.id), ['nmap'])
  assert.deepEqual(loadRingTools(path.join(dir, 'missing')), [])
})

test('commandFor builds armory-cli run invocations', () => {
  const cmd = commandFor({ tool: 'nmap', argv: ['-Pn'] }, '10.0.0.0/24', 'armory')
  assert.equal(cmd, 'armory run nmap --targets=10.0.0.0/24 -- -Pn')
  assert.equal(commandFor({ tool: 'nikto', argv: [] }, null, 'a'), 'a run nikto --')
})
