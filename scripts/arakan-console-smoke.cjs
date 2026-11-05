// Arakan Console live smoke: handshake with the landed binary (B3 verification).
const { spawn } = require('node:child_process')
const path = require('node:path')

const exe = path.join(__dirname, '..', 'resources', 'arakan', 'bin', 'win-x64', 'arakan.exe')
const p = spawn(exe, ['acp'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
let buf = ''
const send = (id, method, params) =>
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')

p.stdout.setEncoding('utf8')
p.stdout.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (line.length === 0) continue
    const message = JSON.parse(line)
    if (message.id === 1) {
      if (message.error) {
        console.log('initialize ERROR:', JSON.stringify(message.error).slice(0, 300))
        p.kill()
        process.exit(1)
      }
      console.log('initialize OK:', JSON.stringify(message.result).slice(0, 140))
      send(2, 'session/new', { cwd: __dirname, mcpServers: [] })
    } else if (message.id === 2) {
      if (message.error) {
        console.log('session/new ERROR:', JSON.stringify(message.error).slice(0, 300))
        p.kill()
        process.exit(1)
      }
      console.log('session/new OK:', JSON.stringify(message.result).slice(0, 140))
      p.kill()
      process.exit(0)
    } else {
      console.log('other message:', line.slice(0, 200))
    }
  }
})
p.stderr.setEncoding('utf8')
p.stderr.on('data', (chunk) => process.stderr.write(chunk))
p.on('exit', (code) => {
  console.log('acp exited early:', code)
  process.exit(1)
})
send(1, 'initialize', { protocolVersion: 1 })
setTimeout(() => {
  console.log('TIMEOUT')
  p.kill()
  process.exit(1)
}, 20000)
