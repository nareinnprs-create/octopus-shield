import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { getPiAgentStatusExtensionSource } from '../../src/main/pi/agent-status-extension-source'
import { test, expect } from './helpers/shield-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'

test('OMP completion retry clears the rendered working indicator', async ({
  shieldPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)
  await waitForActiveTerminalManager(shieldPage, 30_000)
  const endpoint = await readHookEndpoint(electronApp)
  const { paneKey, worktreeId } = await waitForActivePaneHookDescriptor(shieldPage)
  let completions = 0
  const proxy = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) {
      body += chunk
    }
    if (JSON.parse(body).payload.hook_event_name === 'agent_end' && ++completions === 1) {
      response.writeHead(503).end()
      return
    }
    const forwarded = await fetch(`http://127.0.0.1:${endpoint.port}/hook/omp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shield-Agent-Hook-Token': endpoint.token },
      body
    })
    response.writeHead(forwarded.status).end()
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  try {
    const address = proxy.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP listener')
    }
    type Handler = (event: Record<string, unknown>, ctx: { isIdle: () => boolean }) => void
    const handlers = new Map<string, Handler>()
    const module: {
      exports: { default?: (api: { on: (name: string, fn: Handler) => void }) => void }
    } = { exports: {} }
    const { code } = await transform(getPiAgentStatusExtensionSource('omp'), {
      loader: 'ts',
      format: 'cjs'
    })
    runInNewContext(code, {
      module,
      exports: module.exports,
      require: createRequire(join(process.cwd(), 'package.json')),
      process: {
        pid: process.pid,
        argv: [],
        title: 'omp',
        env: {
          OSHIELD_PANE_KEY: paneKey,
          OSHIELD_TAB_ID: paneKey.split(':')[0],
          OSHIELD_WORKTREE_ID: worktreeId,
          OSHIELD_AGENT_HOOK_PORT: String(address.port),
          OSHIELD_AGENT_HOOK_TOKEN: endpoint.token,
          OSHIELD_AGENT_HOOK_ENV: endpoint.env,
          OSHIELD_AGENT_HOOK_VERSION: endpoint.version
        }
      },
      fetch,
      AbortController,
      Buffer,
      console,
      setTimeout,
      clearTimeout
    })
    expect(module.exports.default).toBeDefined()
    module.exports.default?.({ on: (name, fn) => handlers.set(name, fn) })
    const working = shieldPage.locator('[aria-label="Working"]')
    handlers.get('before_agent_start')?.(
      { prompt: 'OMP completion recovery' },
      { isIdle: () => false }
    )
    handlers.get('agent_start')?.({}, { isIdle: () => false })
    await expect(working.first()).toBeVisible()
    await shieldPage.screenshot({ path: testInfo.outputPath('before-working.png') })
    handlers.get('agent_end')?.({ willContinue: false }, { isIdle: () => false })
    await expect.poll(() => completions).toBe(2)
    await expect(working).toHaveCount(0)
    await expect
      .poll(() =>
        shieldPage.evaluate(
          (key) => window.__store?.getState().agentStatusByPaneKey[key]?.state,
          paneKey
        )
      )
      .toBe('done')
    await shieldPage.screenshot({ path: testInfo.outputPath('after-completed.png') })
  } finally {
    proxy.closeAllConnections()
    proxy.close()
  }
})
