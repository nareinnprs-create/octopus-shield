'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHandler, handleLine, loadToolCatalog } = require('./index.cjs')

function tempRingsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolring-mcp-'))
  fs.writeFileSync(
    path.join(dir, 'windows.json'),
    JSON.stringify([{ id: 'nmap', runtime: 'win', status: 'not-discovered' }])
  )
  fs.writeFileSync(
    path.join(dir, 'extra.json'),
    JSON.stringify([
      { id: 'tshark', runtime: 'wsl', status: 'not-discovered', notes: 'packet capture' },
      { _note: 'no id here' },
    ])
  )
  return dir
}

test('initialize returns protocol version, tools capability, server info', () => {
  const res = createHandler({ ringsDir: tempRingsDir() })({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  })
  assert.equal(res.jsonrpc, '2.0')
  assert.equal(res.id, 1)
  assert.equal(res.error, undefined)
  assert.equal(res.result.protocolVersion, '2025-06-18')
  assert.deepEqual(res.result.capabilities, { tools: { listChanged: false } })
  assert.equal(res.result.serverInfo.name, 'toolring-mcp')
})

test('tools/list returns tool ids from rings fixture, skipping malformed entries', () => {
  const res = createHandler({ ringsDir: tempRingsDir() })({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.deepEqual(
    res.result.tools.map((t) => t.name),
    ['tshark', 'nmap']
  )
  for (const tool of res.result.tools) {
    assert.equal(typeof tool.description, 'string')
    assert.deepEqual(tool.inputSchema, { type: 'object', properties: {} })
  }
})

test('loadToolCatalog skips invalid JSON ring files and missing dirs', () => {
  const dir = tempRingsDir()
  fs.writeFileSync(path.join(dir, 'broken.json'), '{not json')
  fs.writeFileSync(path.join(dir, 'shape.json'), '{"id": "not-an-array"}')
  const tools = loadToolCatalog(dir)
  assert.deepEqual(tools.map((t) => t.name), ['tshark', 'nmap'])
  assert.deepEqual(loadToolCatalog(path.join(dir, 'does-not-exist')), [])
})

test('tools/call returns requires-armory-runtime stub for a known tool', () => {
  const res = createHandler({ ringsDir: tempRingsDir() })({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'nmap', arguments: { target: 'example.com' } },
  })
  assert.equal(res.error, undefined)
  assert.equal(res.result.structuredContent.status, 'requires-armory-runtime')
  assert.equal(res.result.structuredContent.tool, 'nmap')
  assert.deepEqual(res.result.structuredContent.arguments, { target: 'example.com' })
  assert.equal(res.result.isError, false)
  assert.equal(res.result.content[0].type, 'text')
})

test('tools/call with unknown tool is -32602', () => {
  const res = createHandler({ ringsDir: tempRingsDir() })({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'nope' },
  })
  assert.equal(res.error.code, -32602)
})

test('unknown method is -32601; ping answers empty result', () => {
  const handler = createHandler({ ringsDir: tempRingsDir() })
  assert.equal(handler({ jsonrpc: '2.0', id: 5, method: 'resources/list' }).error.code, -32601)
  assert.deepEqual(handler({ jsonrpc: '2.0', id: 6, method: 'ping' }).result, {})
})

test('handleLine: parse error -32700, invalid request -32600, notifications muted', () => {
  const handler = createHandler({ ringsDir: tempRingsDir() })
  assert.equal(handleLine(handler, '{bad json').error.code, -32700)
  assert.equal(handleLine(handler, JSON.stringify([1, 2])).error.code, -32600)
  assert.equal(handleLine(handler, JSON.stringify({ jsonrpc: '2.0', method: 'ping' })), null)
  assert.equal(handleLine(handler, JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'nope' })).error.code, -32601)
})

test('stdio end-to-end: spawn server, handshake then tools/list', () => {
  const rings = tempRingsDir()
  const server = path.join(__dirname, 'index.cjs')
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    '',
  ].join('\n')
  const out = spawnSync(process.execPath, [server, '--rings-dir', rings], { input, encoding: 'utf8', timeout: 15000 })
  assert.equal(out.status, 0, `server exited ${out.status}: ${out.stderr}`)
  const lines = out.stdout.trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(lines.length, 2, 'notification must not produce a response')
  assert.equal(lines[0].id, 1)
  assert.equal(lines[0].result.serverInfo.name, 'toolring-mcp')
  assert.deepEqual(lines[1].result.tools.map((t) => t.name), ['tshark', 'nmap'])
})
