'use strict'
// Pure planner: goal plan + ring-discovered tools (+ scope) -> phased task list.
// A technique with no candidate tool present in the rings is reported as
// missing; a phase with zero tasks is a 'gap'. No tool is invented here.

// Static heuristic argv per ring tool id (planning placeholders, not vetted).
const TOOL_ARGS = {
  nmap: ['-Pn', '-sV', '--top-ports', '1000'],
  masscan: ['--top-ports', '1000', '--rate', '1000'],
  httpx: ['-status-code', '-title'],
  subfinder: ['-silent'],
  amass: ['enum', '-passive'],
  nuclei: ['-severity', 'low,medium,high,critical'],
  nikto: [],
  sqlmap: ['--batch', '--level', '1'],
  hydra: [],
  ffuf: ['-mc', '200,301,302,401,403'],
}

function taskArgs(toolId) {
  return TOOL_ARGS[toolId] ?? []
}

/**
 * @param {object} input
 * @param {object} input.plan result of parseGoal()
 * @param {Array<{id: string, runtime?: string, status?: string}>} input.tools ring catalog entries
 * @param {string|null} input.scope declared target scope (cidr/host)
 */
function planTasks({ plan, tools, scope }) {
  const available = new Map((tools ?? []).filter((t) => t && typeof t.id === 'string').map((t) => [t.id, t]))
  const phases = plan.phases.map((phase) => {
    const tasks = []
    const missing = []
    for (const tech of phase.techniques) {
      const toolId = (tech.candidates ?? []).find((id) => available.has(id))
      if (!toolId) {
        missing.push({ technique: tech.id, needed: tech.candidates ?? [] })
        continue
      }
      const ringTool = available.get(toolId)
      tasks.push({
        tool: toolId,
        runtime: ringTool.runtime ?? null,
        ringStatus: ringTool.status ?? null,
        technique: tech.id,
        techniqueName: tech.name,
        techniqueUrl: tech.url,
        argv: taskArgs(toolId),
      })
    }
    return {
      id: phase.id,
      name: phase.name,
      status: tasks.length > 0 ? 'planned' : 'gap',
      tasks,
      missing,
    }
  })
  const planned = phases.filter((p) => p.status === 'planned').length
  return {
    goal: plan.goal,
    known: plan.known,
    scope: scope ?? null,
    phases,
    summary: {
      phases: phases.length,
      planned,
      gaps: phases.length - planned,
      tasks: phases.reduce((n, p) => n + p.tasks.length, 0),
    },
  }
}

module.exports = { planTasks, taskArgs }
