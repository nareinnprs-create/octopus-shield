'use strict'
// X1 increment: goal string -> ordered ATT&CK-mapped attack-phase plan.
// Static heuristic tables; every technique cites its attack.mitre.org page
// but none are human-verified yet (HR4: TODO(verify), never strip).

const PHASE_ORDER = ['recon', 'enumerate', 'exploit', 'post-exploit', 'objective']

const PHASE_NAMES = {
  recon: 'Reconnaissance',
  enumerate: 'Enumeration',
  exploit: 'Exploitation',
  'post-exploit': 'Post-Exploitation',
  objective: 'Objective',
}

// candidates: armory ring tool ids that could serve the technique, first match wins.
function technique(id, name, candidates) {
  const [base, sub] = id.split('.')
  return {
    id,
    name,
    // TODO(verify): confirm technique semantics at the cited page before any X2 use.
    url: `https://attack.mitre.org/techniques/${base}${sub ? `/${sub}` : ''}`,
    citation: 'TODO(verify)',
    candidates,
  }
}

const SHARED_PHASES = [
  {
    id: 'recon',
    techniques: [
      technique('T1595.002', 'Vulnerability Scanning', ['nmap', 'masscan', 'nuclei']),
      technique('T1592', 'Gather Victim Host Information', ['httpx', 'nmap']),
      technique('T1590', 'Gather Victim Identity Information', ['subfinder', 'amass']),
    ],
  },
  {
    id: 'enumerate',
    techniques: [
      technique('T1046', 'Network Service Discovery', ['nmap', 'masscan']),
      technique('T1018', 'Remote System Discovery', ['nmap']),
      technique('T1087', 'Account Discovery', ['hydra']),
    ],
  },
  {
    id: 'exploit',
    techniques: [
      technique('T1190', 'Exploit Public-Facing Application', ['nuclei', 'sqlmap', 'nikto']),
      technique('T1133', 'External Remote Services', ['hydra']),
      technique('T1078', 'Valid Accounts', ['hydra']),
    ],
  },
  {
    id: 'post-exploit',
    techniques: [
      technique('T1003', 'OS Credential Dumping', []),
      technique('T1548', 'Abuse Elevation Control Mechanism', []),
      technique('T1021', 'Remote Services', ['hydra']),
    ],
  },
]

const OBJECTIVE_TECHNIQUES = {
  domain_admin: [
    technique('T1078.002', 'Valid Accounts: Domain Accounts', ['hydra']),
    technique('T1098', 'Account Manipulation', []),
  ],
  full_compromise: [
    technique('T1003', 'OS Credential Dumping', []),
    technique('T1555', 'Credentials from Password Stores', []),
  ],
  web_shell: [technique('T1505.003', 'Server Software Component: Web Shell', ['sqlmap', 'ffuf'])],
}

function buildPhases(objectiveTechniques) {
  const phases = [...SHARED_PHASES, { id: 'objective', techniques: objectiveTechniques }]
  return phases.map((phase) => ({ ...phase, name: PHASE_NAMES[phase.id] }))
}

/**
 * Parse a goal string into an ordered phase plan.
 * Known goals map to a static ATT&CK objective phase; anything else is
 * accepted as a custom goal (slugified) with an unmapped objective phase.
 */
function parseGoal(goalString) {
  const raw = String(goalString ?? '').trim()
  if (!raw) throw new Error('goal string is required')
  const knownGoal = raw in OBJECTIVE_TECHNIQUES
  const goal = knownGoal ? raw : raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'custom'
  return {
    goal,
    known: knownGoal,
    phases: buildPhases(knownGoal ? OBJECTIVE_TECHNIQUES[raw] : []),
  }
}

module.exports = { PHASE_ORDER, parseGoal, technique }
