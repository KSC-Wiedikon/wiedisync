// @vitest-environment happy-dom
//
// The app lock's screen (AppLock): the device's fingerprint/face sheet opens by itself as
// soon as the page is visible and focused — once per lock. Closing the sheet leaves the
// Unlock button and asks nothing again on its own; a refused answer says so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const { unlockOnThisDevice } = vi.hoisted(() => {
  localStorage.setItem('wiedisync-lang', 'en')
  return { unlockOnThisDevice: vi.fn() }
})
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('../../hooks/usePasskeyHint', () => ({ usePasskeyHint: () => ({ on: true, credentialIds: ['key-a'], dismissed: false, lock: true }) }))
vi.mock('../../lib/passkeys', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  passkeysPossible: () => true,
  unlockOnThisDevice,
}))

import '../../i18n'
import AppLock from './AppLock'
import type { MemberUser } from '../../hooks/useAuth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const member = { id: '7', first_name: 'Anna', last_name: 'Muster' } as unknown as MemberUser
let root: Root
let container: HTMLElement
let focused = true

async function renderLock() {
  await act(async () => { root.render(<AppLock member={member} restored onSignOut={() => {}} />) })
}
const lockScreen = () => container.querySelector('[data-testid="app-lock"]')
const unlockButton = () => [...container.querySelectorAll('button')].find((b) => /unlock|waiting/i.test(b.textContent ?? ''))
const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((el) => el.textContent)

beforeEach(() => {
  unlockOnThisDevice.mockReset()
  focused = true
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('the app lock opens the fingerprint sheet by itself', () => {
  it('asks the device as soon as the lock shows, and unlocks on a good answer', async () => {
    unlockOnThisDevice.mockResolvedValue('ok')
    await renderLock()
    expect(unlockOnThisDevice).toHaveBeenCalledTimes(1)
    expect(unlockOnThisDevice).toHaveBeenCalledWith('7')
    expect(lockScreen()).toBeNull()
  })

  it('a closed sheet leaves the Unlock button, no error, and does not ask again on its own', async () => {
    unlockOnThisDevice.mockResolvedValue('cancel')
    await renderLock()
    expect(lockScreen()).not.toBeNull()
    expect(unlockButton()).toBeDefined()
    expect(alerts()).toEqual([])
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(unlockOnThisDevice).toHaveBeenCalledTimes(1)
    // The button still works.
    unlockOnThisDevice.mockResolvedValue('ok')
    await act(async () => { unlockButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(unlockOnThisDevice).toHaveBeenCalledTimes(2)
    expect(lockScreen()).toBeNull()
  })

  it('waits for focus before asking (Chrome refuses a page without it)', async () => {
    focused = false
    unlockOnThisDevice.mockResolvedValue('ok')
    await renderLock()
    expect(unlockOnThisDevice).not.toHaveBeenCalled()
    expect(lockScreen()).not.toBeNull()
    focused = true
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(unlockOnThisDevice).toHaveBeenCalledTimes(1)
    expect(lockScreen()).toBeNull()
  })

  it('a refused answer says so and stays locked', async () => {
    unlockOnThisDevice.mockResolvedValue('refused')
    await renderLock()
    expect(lockScreen()).not.toBeNull()
    expect(alerts()).toHaveLength(1)
  })
})
