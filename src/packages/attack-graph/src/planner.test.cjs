'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseGoal } = require('./goal.cjs')
const { planTasks, taskArgs } = require('./planner.cjs')

const RING_TOOLS = [
  { id: 'nmap', runtime: 'win', status: 'ok' },
  { id: 'httpx', runtime: 'docker', status: 'not-discovered' },
  { id: 'sqlmap', runtime: 'docker', status: 'ok' },
]

test('tasks pick the first candidate tool present in the rings, carrying ring state', () => {
  const result = planTasks({ plan: parseGoal('domain_admin'), tools: RING_TOOLS, scope: '10.0.0.0/24' })
  const recon = result.phases.find((p) => p.id === 'recon')
  assert.equal(recon.status, 'planned')
  assert.equal(recon.tasks[0].tool, 'nmap')
  assert.equal(recon.tasks[0].technique, 'T1595.002')
  assert.equal(recon.tasks[0].ringStatus, 'ok')
  assert.deepEqual(recon.tasks[0].argv, taskArgs('nmap'))
  assert.equal(result.scope, '10.0.0.0/24')
})

test('techniques whose candidates are absent are marked missing; empty phases are gaps', () => {
  const plan = parseGoal('full_compromise')
  const result = planTasks({ plan, tools: [], scope: null })
  assert.equal(result.summary.planned, 0)
  assert.equal(result.summary.gaps, result.phases.length)
  for (const phase of result.phases) {
    assert.equal(phase.status, 'gap')
    assert.deepEqual(phase.tasks, [])
    assert.equal(phase.missing.length, plan.phases.find((p) => p.id === phase.id).techniques.length)
    assert.ok(phase.missing.every((m) => Array.isArray(m.needed)))
  }
})

test('candidate order decides the tool; ring-only tools are never invented', () => {
  const result = planTasks({ plan: parseGoal('domain_admin'), tools: [{ id: 'masscan' }, { id: 'nuclei' }], scope: null })
  const recon = result.phases.find((p) => p.id === 'recon')
  assert.deepEqual(recon.tasks.map((t) => t.technique), ['T1595.002'])
  assert.equal(recon.tasks[0].tool, 'masscan')
  const postExploit = result.phases.find((p) => p.id === 'post-exploit')
  assert.deepEqual(postExploit.missing.find((m) => m.technique === 'T1003').needed, [])
})

test('summary counts planned vs gap phases and total tasks', () => {
  const result = planTasks({ plan: parseGoal('web_shell'), tools: RING_TOOLS, scope: null })
  assert.equal(result.summary.phases, 5)
  assert.equal(result.summary.tasks, result.phases.reduce((n, p) => n + p.tasks.length, 0))
  assert.ok(result.summary.planned > 0)
  assert.ok(result.summary.gaps > 0, 'credential-dump techniques have no ring tool -> honest gaps')
})

test('tool with no static argv gets an empty args array (targets still apply)', () => {
  assert.deepEqual(taskArgs('nikto'), [])
  assert.deepEqual(taskArgs('never-seen-this-tool'), [])
})
