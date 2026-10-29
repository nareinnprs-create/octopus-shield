import { renderToStaticMarkup } from 'react-dom/server'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {
    activeModal: 'confirm-shield-yaml-hooks' as string | null,
    modalData: {} as Record<string, unknown>,
    closeModal: vi.fn(),
    markShieldHookScriptConfirmed: vi.fn(),
    markShieldHookRepoAlwaysTrusted: vi.fn()
  }
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    {
      getState: () => mocks.state
    }
  )
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  )
}))

// Use English fallbacks so this JSX-whitespace regression is independent of locale loading.
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

function decodeHtml(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

describe('ShieldYamlTrustDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.activeModal = 'confirm-shield-yaml-hooks'
    mocks.state.modalData = {
      repoId: 'repo-1',
      repoName: 'shield',
      scriptKind: 'setup',
      scriptContent: 'node config/scripts/run-internal-dev-setup.mjs\npnpm install',
      contentHash: 'hash-1',
      previouslyApproved: false
    }
  })

  it('keeps spaces around shield.yaml and the repo name in the first-run copy', async () => {
    const { default: ShieldYamlTrustDialog } = await import('./ShieldYamlTrustDialog')
    const text = decodeHtml(renderToStaticMarkup(<ShieldYamlTrustDialog />)).replace(/<[^>]+>/g, '')

    expect(text).toContain("This repository's shield.yaml runs on your machine")
    expect(text).toContain('Only run if you trust shield.')
    expect(text).toContain('Always trust shield.yaml in shield')
    expect(text).not.toContain("repository'sshield.yaml")
    expect(text).not.toContain('trustshield')
    expect(text).not.toContain('trustshield.yaml')
    expect(text).not.toContain('inshield')
  })

  it('keeps spaces around shield.yaml when the script changed since last approval', async () => {
    mocks.state.modalData = {
      ...mocks.state.modalData,
      previouslyApproved: true
    }
    const { default: ShieldYamlTrustDialog } = await import('./ShieldYamlTrustDialog')
    const text = decodeHtml(renderToStaticMarkup(<ShieldYamlTrustDialog />)).replace(/<[^>]+>/g, '')

    expect(text).toContain('shield.yaml changed since you last approved')
    expect(text).toContain('Always trust shield.yaml in shield')
    expect(text).not.toContain('Always trustshield.yaml')
    expect(text).not.toContain('inshield')
  })
})
