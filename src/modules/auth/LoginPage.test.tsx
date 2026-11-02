// @vitest-environment happy-dom
//
// The sign-in page's passkey button (LoginPage): shown only where passkeys work, first
// when this browser has used one, below the password form otherwise. A passkey sign-in
// lands exactly like a password one; a closed device sheet says nothing; any other
// failure says why and leaves the password form in place.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { auth, passkeysPossible, anyPasskeyHere } = vi.hoisted(() => {
  localStorage.setItem('wiedisync-lang', 'en')
  return {
    auth: { login: vi.fn(), loginWithPasskey: vi.fn(), user: null },
    passkeysPossible: vi.fn(() => true),
    anyPasskeyHere: vi.fn(() => false),
  }
})
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@/components/SupportContact', () => ({ default: () => null }))
vi.mock('@/components/LanguageDropdown', () => ({ default: () => null }))
vi.mock('../../lib/passkeys', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  passkeysPossible,
  anyPasskeyHere,
}))

import '../../i18n'
import LoginPage from './LoginPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLElement

function renderLogin() {
  act(() => root.render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  ))
}
const passkeyButton = () => container.querySelector<HTMLButtonElement>('[data-testid="passkey-sign-in"]')
const submitButton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')
const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((el) => el.textContent)
async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull()
  await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}
const before = (a: Node | null, b: Node | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const serverError = (status: number, code: string) => Object.assign(new Error(`API /passkey/login: ${status}`), { status, code })

beforeEach(() => {
  auth.login.mockReset()
  auth.loginWithPasskey.mockReset()
  passkeysPossible.mockReturnValue(true)
  anyPasskeyHere.mockReturnValue(false)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('LoginPage passkey button', () => {
  it('is not there where passkeys cannot work', () => {
    passkeysPossible.mockReturnValue(false)
    renderLogin()
    expect(passkeyButton()).toBeNull()
    expect(submitButton()?.textContent).toBe('Sign in')
  })

  it('sits below the password form when this browser has no passkey yet', () => {
    renderLogin()
    expect(passkeyButton()?.textContent).toBe('Sign in with fingerprint or face')
    expect(before(submitButton(), passkeyButton())).toBe(true)
  })

  it('leads when this browser has set up or used one', () => {
    anyPasskeyHere.mockReturnValue(true)
    renderLogin()
    const email = container.querySelector('input[type="email"]')
    expect(before(passkeyButton(), email)).toBe(true)
  })

  it('signs in and lands like a password sign-in', async () => {
    auth.loginWithPasskey.mockResolvedValue(undefined)
    renderLogin()
    await click(passkeyButton())
    expect(auth.loginWithPasskey).toHaveBeenCalledTimes(1)
    expect(auth.login).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Home page')
  })

  it('says nothing when the device sheet is closed', async () => {
    auth.loginWithPasskey.mockRejectedValue(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }))
    renderLogin()
    await click(passkeyButton())
    expect(alerts()).toEqual([])
    expect(passkeyButton()?.disabled).toBe(false)
    expect(container.textContent).not.toContain('Home page')
  })

  it('explains a key that is no longer set up, and keeps the password form', async () => {
    auth.loginWithPasskey.mockRejectedValue(serverError(401, 'passkey_unknown'))
    renderLogin()
    await click(passkeyButton())
    expect(alerts()).toEqual(['This passkey is no longer set up — it was removed, or your password was changed. Sign in with your password.'])
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
    expect(submitButton()?.disabled).toBe(false)
  })

  it('an expired or unbound ceremony just asks to try again', async () => {
    auth.loginWithPasskey.mockRejectedValue(serverError(400, 'passkey_challenge'))
    renderLogin()
    await click(passkeyButton())
    expect(alerts()).toEqual(['Please try again.'])
  })

  it('the licence lock reads as "not possible right now"', async () => {
    auth.loginWithPasskey.mockRejectedValue(serverError(403, 'resource_restricted'))
    renderLogin()
    await click(passkeyButton())
    expect(alerts()).toEqual(['Sign-in is not possible right now.'])
  })
})
