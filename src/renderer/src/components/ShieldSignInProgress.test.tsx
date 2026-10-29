// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ShieldCloudSignInProgress } from '../../../shared/shield-profiles'
import { ShieldSignInButton, ShieldSignInWaitNotice } from './ShieldSignInProgress'

type SignInState = {
  shieldProfileSignInProgress: ShieldCloudSignInProgress | null
  connectCurrentShieldProfile: Mock
}

const mocks = vi.hoisted((): { state: SignInState; toastError: Mock; toastSuccess: Mock } => ({
  state: { shieldProfileSignInProgress: null, connectCurrentShieldProfile: vi.fn() },
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: (selector: (state: SignInState) => unknown) => selector(mocks.state)
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

const LINK = 'https://login.example/authorize?state=abc'

describe('Shield sign-in progress', () => {
  const writeClipboardText = vi.fn()
  const cancelSignIn = vi.fn()

  beforeEach(() => {
    mocks.state.shieldProfileSignInProgress = null
    mocks.state.connectCurrentShieldProfile.mockReset()
    mocks.toastError.mockReset()
    mocks.toastSuccess.mockReset()
    writeClipboardText.mockReset().mockResolvedValue(undefined)
    cancelSignIn.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { writeClipboardText }, shieldProfiles: { cancelSignIn } }
    })
  })

  afterEach(() => cleanup())

  it('starts a sign-in from the button', async () => {
    render(<ShieldSignInButton>Sign in to Shield</ShieldSignInButton>)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in to Shield' }))

    expect(mocks.state.connectCurrentShieldProfile).toHaveBeenCalledOnce()
  })

  it('greys the button out as Signing in… while a sign-in is in flight', () => {
    mocks.state.shieldProfileSignInProgress = { link: null }
    render(<ShieldSignInButton>Sign in to Shield</ShieldSignInButton>)

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
  })

  it('omits the waiting notice until the sign-in link is available', () => {
    mocks.state.shieldProfileSignInProgress = { link: null }
    const { container } = render(<ShieldSignInWaitNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it('copies the waiting link', async () => {
    mocks.state.shieldProfileSignInProgress = { link: LINK }
    render(<ShieldSignInWaitNotice />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for sign-in in your browser')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy sign-in link' }))

    expect(writeClipboardText).toHaveBeenCalledWith(LINK)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Sign-in link copied')
  })

  it('reports a failed clipboard write', async () => {
    mocks.state.shieldProfileSignInProgress = { link: LINK }
    writeClipboardText.mockRejectedValue(new Error('denied'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<ShieldSignInWaitNotice />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy sign-in link' }))

    expect(mocks.toastError).toHaveBeenCalledWith('Could not copy the link.')
  })

  it('cancels the browser wait', async () => {
    mocks.state.shieldProfileSignInProgress = { link: LINK }
    render(<ShieldSignInWaitNotice />)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))

    expect(cancelSignIn).toHaveBeenCalledOnce()
  })
})
