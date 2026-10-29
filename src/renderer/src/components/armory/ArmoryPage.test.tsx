// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ArmoryRunOutcome,
  ArmoryScopeState,
  ArmoryToolView
} from '../../../../shared/armory-contract'
import type * as DialogUi from '../ui/dialog'

const armoryMocks = vi.hoisted(() => ({
  list: vi.fn(),
  scope: vi.fn(),
  health: vi.fn(),
  run: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    values
      ? Object.entries(values).reduce(
          (text, [token, value]) => text.replace(`{{${token}}}`, value),
          fallback
        )
      : fallback
}))

vi.mock('../ui/dialog', async (importOriginal) => ({
  ...(await importOriginal<typeof DialogUi>()),
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="armory-run-dialog" className={className}>
      {children}
    </div>
  )
}))

import ArmoryPage from './ArmoryPage'

const tool = (overrides: Partial<ArmoryToolView> = {}): ArmoryToolView => ({
  id: 'nmap',
  title: 'nmap',
  category: 'recon',
  runtime: 'docker',
  target: 'nmap:latest',
  scopeClass: 'recon',
  status: 'ok',
  ...overrides
})

const scopeState = (overrides: Partial<ArmoryScopeState> = {}): ArmoryScopeState => ({
  raw: '10.0.0.5,192.168.1.0/24',
  targets: ['10.0.0.5'],
  cidrs: ['192.168.1.0/24'],
  exploitAuthorized: false,
  authorized: true,
  ...overrides
})

const allowedOutcome = (): Extract<ArmoryRunOutcome, { ok: true }> => ({
  ok: true,
  record: {
    toolId: 'nmap',
    argv: ['docker', 'run', '--rm', 'nmap:latest', '-sV', '10.0.0.5'],
    targets: ['10.0.0.5'],
    exitCode: 0,
    timedOut: false,
    durationMs: 421,
    stdout: 'PORT     STATE\n80/tcp   open\n',
    stderr: '',
    audited: true
  },
  auditEvent: {
    tsEpochMs: 1_760_000_000_000,
    actorKind: 'tentacle',
    actorId: 'armory',
    action: 'armory.run',
    resourceKind: 'armory-tool',
    resourceId: 'nmap',
    traceId: null,
    payload: { argv: ['docker'], exitCode: 0 }
  }
})

describe('ArmoryPage', () => {
  beforeEach(() => {
    armoryMocks.list.mockResolvedValue([
      tool(),
      tool({ id: 'sqlmap', category: 'web', scopeClass: 'web', status: 'failed' })
    ])
    armoryMocks.scope.mockResolvedValue(scopeState())
    armoryMocks.health.mockResolvedValue({
      entries: [],
      healthy: 0,
      checkable: 0
    })
    armoryMocks.run.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { armory: armoryMocks }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('lists integrated tools with status chip, runtime, category, and scope class', async () => {
    render(<ArmoryPage />)

    const table = await screen.findByRole('table')
    expect(within(table).getByText('nmap')).toBeInTheDocument()
    expect(within(table).getByText('Installed')).toBeInTheDocument()
    expect(within(table).getByText('sqlmap')).toBeInTheDocument()
    expect(within(table).getByText('Failed')).toBeInTheDocument()
    const nmapRow = within(screen.getByText('nmap').closest('tr') as HTMLTableRowElement)
    expect(nmapRow.getByText('docker')).toBeInTheDocument()
    expect(nmapRow.getByText('nmap:latest')).toBeInTheDocument()
    expect(nmapRow.getAllByText('recon').length).toBe(2)
  })

  it('shows the scope authorization state', async () => {
    render(<ArmoryPage />)

    expect(await screen.findByText('Scope authorized')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.5, 192.168.1.0/24')).toBeInTheDocument()
  })

  it('runs a tool only from the dialog with explicit targets and shows output + audit event', async () => {
    const user = userEvent.setup()
    armoryMocks.run.mockResolvedValue(allowedOutcome())
    render(<ArmoryPage />)

    await screen.findByRole('table')
    await user.click(
      within(screen.getByText('nmap').closest('tr') as HTMLTableRowElement).getByRole('button', {
        name: 'Run'
      })
    )

    const dialog = screen.getByTestId('armory-run-dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Run tool' })
    expect(confirm).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Targets'), '10.0.0.5')
    await user.type(within(dialog).getByLabelText('Arguments'), '-sV')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(armoryMocks.run).toHaveBeenCalledWith({
      toolId: 'nmap',
      targets: ['10.0.0.5'],
      args: ['-sV']
    })
    await waitFor(() => expect(screen.getByText('exit 0')).toBeInTheDocument())
    expect(screen.getByText(/"action": "armory\.run"/)).toBeInTheDocument()
    expect(screen.getByText(/80\/tcp\s+open/)).toBeInTheDocument()
  })

  it('shows the DENIED reason verbatim and no output when scope authorization fails', async () => {
    const user = userEvent.setup()
    armoryMocks.run.mockResolvedValue({
      ok: false,
      reason: 'target outside authorized scope: 10.9.9.9'
    })
    render(<ArmoryPage />)

    await screen.findByRole('table')
    await user.click(
      within(screen.getByText('nmap').closest('tr') as HTMLTableRowElement).getByRole('button', {
        name: 'Run'
      })
    )
    const dialog = screen.getByTestId('armory-run-dialog')
    await user.type(within(dialog).getByLabelText('Targets'), '10.9.9.9')
    await user.click(within(dialog).getByRole('button', { name: 'Run tool' }))

    expect(await screen.findByText('DENIED')).toBeInTheDocument()
    expect(screen.getByText('target outside authorized scope: 10.9.9.9')).toBeInTheDocument()
  })
})
