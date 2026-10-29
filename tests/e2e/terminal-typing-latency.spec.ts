import {
  KEY_LATENCY_SAMPLES,
  MAX_MEDIAN_KEY_LATENCY_MS,
  MAX_WORST_KEY_LATENCY_MS,
  interactivePromptScript,
  waitForMarkerLatency,
  median
} from './helpers/terminal-typing-benchmark'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/shield-app'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput,
  sendToTerminal
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.describe('Terminal typing latency', () => {
  test('interactive prompt echoes typed keys without visible lag', async ({
    shieldPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    await ensureTerminalVisible(shieldPage)
    await waitForActiveTerminalManager(shieldPage, 30_000)

    const ptyId = await waitForActivePanePtyId(shieldPage)
    const runId = randomUUID()
    const scriptPath = path.join(testRepoPath, `.shield-typing-benchmark-${runId}.mjs`)
    writeFileSync(scriptPath, interactivePromptScript(runId))
    let commandSent = false
    try {
      await sendToTerminal(shieldPage, ptyId, `node ${JSON.stringify(scriptPath)}\r`)
      commandSent = true
      await waitForTerminalOutput(shieldPage, `TYPING_READY_${runId}`, 10_000)
      await focusActiveTerminalInput(shieldPage)

      const latencies: number[] = []
      for (const [index, char] of [...KEY_LATENCY_SAMPLES].entries()) {
        const seq = index + 1
        const marker = `TYPING_KEY_${runId}_${seq}`
        const start = performance.now()
        await shieldPage.keyboard.type(char)
        await waitForMarkerLatency(shieldPage, marker, MAX_WORST_KEY_LATENCY_MS)
        latencies.push(performance.now() - start)
      }

      const medianLatency = median(latencies)
      const worstLatency = Math.max(...latencies)
      testInfo.annotations.push({
        type: 'terminal-typing-latency',
        description: `median=${medianLatency.toFixed(1)}ms worst=${worstLatency.toFixed(1)}ms samples=${latencies
          .map((value) => value.toFixed(1))
          .join(',')}`
      })

      expect(medianLatency).toBeLessThan(MAX_MEDIAN_KEY_LATENCY_MS)
      expect(worstLatency).toBeLessThan(MAX_WORST_KEY_LATENCY_MS)
    } finally {
      if (commandSent) {
        await sendToTerminal(shieldPage, ptyId, '\x03').catch(() => undefined)
      }
      rmSync(scriptPath, { force: true })
    }
  })
})
