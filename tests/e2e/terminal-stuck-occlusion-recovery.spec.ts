// v1.4.124-rc.2.perf (2026-07-06): macOS display-sleep occlusion stuck hidden, dropping 78MB across two visible PTYs despite healthy transport.
// Pin hidden with one final visibilitychange, then require a real keystroke to prove staleness, unlatch delivery and restore missed output without reload/event.
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/shield-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'
import {
  waitForActiveTerminalManager,
  waitForActivePanePtyId,
  execInTerminal,
  getTerminalContent
} from './helpers/terminal'

type DeliverySnapshot = {
  hiddenDeliveryGatedPtyCount: number
  hiddenDeliveryGatedVisiblePtyCount: number
  hiddenDeliveryDroppedChars: number
}

async function getDeliverySnapshot(page: Page): Promise<DeliverySnapshot> {
  return page.evaluate(async () => {
    const snapshot = await window.api.pty.getRendererDeliveryDebugSnapshot()
    return {
      hiddenDeliveryGatedPtyCount: snapshot.hiddenDeliveryGatedPtyCount,
      hiddenDeliveryGatedVisiblePtyCount: snapshot.hiddenDeliveryGatedVisiblePtyCount,
      hiddenDeliveryDroppedChars: snapshot.hiddenDeliveryDroppedChars
    }
  })
}

test.describe('terminal stuck-occlusion recovery', () => {
  test.afterEach(async ({ shieldPage }) => {
    // Remove the instance override and emit visibilitychange so the real prototype state restores tracker trust.
    await shieldPage.evaluate(() => {
      delete (document as { visibilityState?: string }).visibilityState
      document.dispatchEvent(new Event('visibilitychange'))
    })
  })

  test('a keystroke unlatches the hidden-delivery gate wedged by stale visibilityState', async ({
    shieldPage
  }) => {
    test.setTimeout(120_000)
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    await ensureTerminalVisible(shieldPage)
    await waitForActiveTerminalManager(shieldPage)
    const ptyId = await waitForActivePanePtyId(shieldPage)

    // Live baseline: foreground delivery works. The $((…)) arithmetic keeps
    // the asserted string out of the typed command's local echo.
    await execInTerminal(shieldPage, ptyId, 'echo live-before-$((41+1))')
    await expect
      .poll(async () => getTerminalContent(shieldPage), { timeout: 15_000 })
      .toContain('live-before-42')

    // Emulate the Chromium occlusion wedge: visibilityState pins at 'hidden',
    // one last visibilitychange fires, then the tracker goes silent forever.
    await shieldPage.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'hidden',
        configurable: true
      })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // The visible pane's pty gets marked hidden in main — the field state:
    // gate holding a pty that main's own visibility set says is visible.
    await expect
      .poll(async () => (await getDeliverySnapshot(shieldPage)).hiddenDeliveryGatedPtyCount, {
        timeout: 15_000
      })
      .toBeGreaterThan(0)
    expect(
      (await getDeliverySnapshot(shieldPage)).hiddenDeliveryGatedVisiblePtyCount
    ).toBeGreaterThan(0)

    // The freeze repro: output produced now is dropped by main, not painted.
    const droppedBefore = (await getDeliverySnapshot(shieldPage)).hiddenDeliveryDroppedChars
    await execInTerminal(shieldPage, ptyId, 'echo occluded-$((70+8))')
    await expect
      .poll(async () => (await getDeliverySnapshot(shieldPage)).hiddenDeliveryDroppedChars, {
        timeout: 15_000
      })
      .toBeGreaterThan(droppedBefore)
    expect(await getTerminalContent(shieldPage)).not.toContain('occluded-78')

    // The staleness proof: one real keystroke while the document claims
    // hidden. No visibilitychange fires — recovery must ride the proof alone.
    await shieldPage.keyboard.press('Shift')

    // Gate unlatches and the missed output repaints from the main-owned
    // snapshot — no reload, visibilityState still reads 'hidden'.
    await expect
      .poll(async () => getTerminalContent(shieldPage), { timeout: 30_000 })
      .toContain('occluded-78')
    await expect
      .poll(async () => (await getDeliverySnapshot(shieldPage)).hiddenDeliveryGatedVisiblePtyCount, {
        timeout: 15_000
      })
      .toBe(0)

    // Live delivery continues under the override.
    await execInTerminal(shieldPage, ptyId, 'echo live-after-$((200+56))')
    await expect
      .poll(async () => getTerminalContent(shieldPage), { timeout: 15_000 })
      .toContain('live-after-256')

    // Require episode history in renderer breadcrumbs and main’s per-PTY table for the production one-paste freeze path.
    const report = await shieldPage.evaluate(() =>
      (
        window as Window & {
          __shieldTerminalFreezeReport?: () => Promise<{
            renderer: { breadcrumbs: { kind: string }[]; documentVisibilityProvenStale: boolean }
            main: { diagnostics: { perPty: unknown[]; breadcrumbs: { kind: string }[] } }
          }>
        }
      ).__shieldTerminalFreezeReport?.()
    )
    if (!report) {
      throw new Error('freeze report global missing from prod-path renderer')
    }
    expect(report.renderer.documentVisibilityProvenStale).toBe(true)
    const rendererKinds = report.renderer.breadcrumbs.map((crumb) => crumb.kind)
    expect(rendererKinds).toContain('stale-visibility-latch')
    expect(rendererKinds).toContain('renderer-gate-unmark')
    expect(report.main.diagnostics.perPty.length).toBeGreaterThan(0)
    const mainKinds = report.main.diagnostics.breadcrumbs.map((crumb) => crumb.kind)
    expect(mainKinds).toContain('gate-mark')
    expect(mainKinds).toContain('gate-unmark')
  })
})
