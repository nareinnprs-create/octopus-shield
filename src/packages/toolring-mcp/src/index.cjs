'use strict'
// X12 skeleton: MCP server exposing the Armory toolring over newline-delimited
// JSON-RPC 2.0 on stdio. Node stdlib only; tools/call is a stub until the
// armory tool-runner bridge lands (see README roadmap).

const fs = require('node:fs')
const path = require('node:path')

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'toolring-mcp', version: '0.1.0' }

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
}

function parseArgs(argv) {
  const i = argv.indexOf('--rings-dir')
  const ringsDir = i >= 0 && argv[i + 1] ? argv[i + 1] : './resources/armory/inventory'
  return { ringsDir: path.resolve(ringsDir) }
}

// Rings dir holds *.json files, each an array of { id, runtime, status, notes }.
// Malformed files/entries are skipped, not fatal: a bad ring must not take the server down.
function loadToolCatalog(ringsDir) {
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
      const bits = []
      if (entry.runtime) bits.push(`runtime: ${entry.runtime}`)
      if (entry.status) bits.push(`status: ${entry.status}`)
      if (entry.notes) bits.push(entry.notes)
      tools.push({
        name: entry.id,
        description: `[${file}] ${bits.join(' — ')}`,
        inputSchema: { type: 'object', properties: {} },
      })
    }
  }
  return tools
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function fail(id, code, message, data) {
  const error = { code, message }
  if (data !== undefined) error.data = data
  return { jsonrpc: '2.0', id, error }
}

function createHandler({ ringsDir }) {
  const tools = loadToolCatalog(ringsDir)
  const known = new Set(tools.map((t) => t.name))

  return function handle(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.method !== 'string') {
      return fail(request && typeof request.id === 'string' || typeof request?.id === 'number' ? request.id : null, ERR.INVALID_REQUEST, 'Invalid Request')
    }
    const { id, method, params } = request
    const isNotification = id === undefined || id === null

    if (isNotification) return null

    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        })
      case 'ping':
        return ok(id, {})
      case 'tools/list':
        return ok(id, { tools })
      case 'tools/call': {
        const name = params && params.name
        if (typeof name !== 'string' || !known.has(name)) {
          return fail(id, ERR.INVALID_PARAMS, `Unknown tool: ${String(name)}`)
        }
        // Stub until the armory tool-runner bridge + scope gating land.
        return ok(id, {
          content: [{ type: 'text', text: `Tool "${name}" requires the armory runtime; not wired in this skeleton.` }],
          structuredContent: { status: 'requires-armory-runtime', tool: name, arguments: params.arguments ?? null },
          isError: false,
        })
      }
      default:
        return fail(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`)
    }
  }
}

function handleLine(handler, line) {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return fail(null, ERR.PARSE, 'Parse error')
  }
  return handler(request)
}

function serve({ input = process.stdin, output = process.stdout, argv = process.argv } = {}) {
  const handler = createHandler(parseArgs(argv))
  let buffer = ''
  input.setEncoding('utf8')
  input.on('data', (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const response = handleLine(handler, line)
      if (response) output.write(JSON.stringify(response) + '\n')
    }
  })
}

if (require.main === module) serve()

module.exports = {
  ERR,
  PROTOCOL_VERSION,
  SERVER_INFO,
  createHandler,
  handleLine,
  loadToolCatalog,
  parseArgs,
  serve,
}
