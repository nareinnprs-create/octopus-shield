// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BrowserReloadControl } from './browser-reload-control'

function Control(props: { menuOpen: boolean }): React.JSX.Element {
  return (
    <TooltipProvider>
      <BrowserReloadControl
        menuOpen={props.menuOpen}
        onMenuOpenChange={() => {}}
        label="Reload page"
        showShortcutHint={false}
        reloadShortcut="Ctrl+R"
        hardReloadShortcut="Ctrl+Shift+R"
        onPrimary={() => {}}
        onReload={() => {}}
        onHardReload={() => {}}
      />
    </TooltipProvider>
  )
}

describe('BrowserReloadControl tooltip', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  // The tooltip open prop must never flip between defined and undefined across renders.
  it('keeps the tooltip controlled when the menu opens and closes', () => {
    const view = render(<Control menuOpen={false} />)
    view.rerender(<Control menuOpen={true} />)
    view.rerender(<Control menuOpen={false} />)
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('is changing from'))
  })

  it('suppresses the tooltip while the menu is open and shows it on focus when closed', () => {
    const view = render(<Control menuOpen={false} />)
    const trigger = screen.getByRole('button', { name: 'Reload page' })
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip').textContent).toContain('Reload page')
    fireEvent.blur(trigger)

    view.rerender(<Control menuOpen={true} />)
    fireEvent.focus(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('is changing from'))
  })
})
