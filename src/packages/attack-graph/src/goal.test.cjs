'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseGoal, PHASE_ORDER } = require('./goal.cjs')

test('known goal parses into the five ordered phases with ATT&CK citations', () => {
  const plan = parseGoal('domain_admin')
  assert.equal(plan.known, true)
  assert.deepEqual(plan.phases.map((p) => p.id), PHASE_ORDER)
  for (const phase of plan.phases) {
    assert.equal(typeof phase.name, 'string')
    for (const tech of phase.techniques) {
      assert.match(tech.id, /^T\d{4}(\.\d{3})?$/)
      assert.match(tech.url, /^https:\/\/attack\.mitre\.org\/techniques\//)
      assert.equal(tech.citation, 'TODO(verify)')
    }
  }
})

test('each built-in goal carries its own objective techniques', () => {
  const goals = ['domain_admin', 'full_compromise', 'web_shell']
  const seen = new Set(goals.map((g) => parseGoal(g).phases.at(-1).techniques.map((t) => t.id).join(',')))
  assert.equal(seen.size, goals.length)
  assert.deepEqual(parseGoal('web_shell').phases.at(-1).techniques.map((t) => t.id), ['T1505.003'])
})

test('custom goal is slugified and keeps an unmapped objective phase', () => {
  const plan = parseGoal('Dump the Krbtgt Hash!!')
  assert.equal(plan.known, false)
  assert.equal(plan.goal, 'dump_the_krbtgt_hash')
  assert.deepEqual(plan.phases.map((p) => p.id), PHASE_ORDER)
  assert.deepEqual(plan.phases.at(-1).techniques, [])
})

test('empty or blank goal is rejected', () => {
  assert.throws(() => parseGoal(''), /goal string is required/)
  assert.throws(() => parseGoal('   '), /goal string is required/)
})
