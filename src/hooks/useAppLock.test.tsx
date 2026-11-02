// @vitest-environment happy-dom
//
// WHEN the optional app lock shows (useAppLock): once after a cold start with a restored
// session, and after ≥ 5 minutes in the background — never after a sign-in made in this
// page's lifetime, never when switched off, and nothing stays locked for the next member.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { APP_LOCK_AFTER_HIDDEN_MS, useAppLock, type AppLockOptions } from './useAppLock'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let clock = 0
const now = () => clock
let visibility: DocumentVisibilityState = 'visible'

let result: { locked: boolean; unlock: () => void }
const expose = (r: typeof result) => { result = r }
function Probe(props: AppLockOptions) {
  const r = useAppLock({ ...props, now })
  useEffect(() => { expose(r) })
  return null
}

let root: Root
let container: HTMLElement
function render(props: Omit<AppLockOptions, 'now'>) {
  act(() => root.render(<Probe {...props} />))
}
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}
function backgroundFor(ms: number) {
  setVisibility('hidden')
  clock += ms
  setVisibility('visible')
}

beforeEach(() => {
  clock = 1_000_000
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useAppLock', () => {
  it('locks a restored session at a cold start, once, until unlocked', () => {
    render({ enabled: true, lockOnStart: true })
    expect(result.locked).toBe(true)
    act(() => result.unlock())
    expect(result.locked).toBe(false)
    render({ enabled: true, lockOnStart: true }) // a re-render does not re-lock
    expect(result.locked).toBe(false)
  })

  it('does not lock a sign-in made in this page\'s lifetime', () => {
    render({ enabled: true, lockOnStart: false })
    expect(result.locked).toBe(false)
  })

  it('waits for the member: the cold-start lock applies when the lock first does', () => {
    render({ enabled: false, lockOnStart: false }) // session still restoring
    expect(result.locked).toBe(false)
    render({ enabled: true, lockOnStart: true }) // member + hint loaded in one go
    expect(result.locked).toBe(true)
  })

  it('locks after 5 minutes in the background, not before', () => {
    render({ enabled: true, lockOnStart: false })
    backgroundFor(APP_LOCK_AFTER_HIDDEN_MS - 1)
    expect(result.locked).toBe(false)
    backgroundFor(APP_LOCK_AFTER_HIDDEN_MS)
    expect(result.locked).toBe(true)
    act(() => result.unlock())
    expect(result.locked).toBe(false)
  })

  it('counts from the moment the page was first hidden', () => {
    render({ enabled: true, lockOnStart: false })
    setVisibility('hidden')
    clock += 3 * 60_000
    setVisibility('hidden') // a second hidden event must not restart the clock
    clock += 2 * 60_000
    setVisibility('visible')
    expect(result.locked).toBe(true)
  })

  it('never locks when switched off', () => {
    render({ enabled: false, lockOnStart: true })
    backgroundFor(APP_LOCK_AFTER_HIDDEN_MS * 10)
    expect(result.locked).toBe(false)
  })

  it('switching off (or signing out) clears the lock, and a fresh sign-in is not locked', () => {
    render({ enabled: true, lockOnStart: true })
    expect(result.locked).toBe(true)
    render({ enabled: false, lockOnStart: true }) // "Log out" on the lock screen
    expect(result.locked).toBe(false)
    render({ enabled: true, lockOnStart: false }) // signed in again in the same page
    expect(result.locked).toBe(false)
  })

  it('a background spell from before the lock went off does not count later', () => {
    render({ enabled: true, lockOnStart: false })
    setVisibility('hidden')
    render({ enabled: false, lockOnStart: false }) // e.g. the session ended while hidden
    clock += APP_LOCK_AFTER_HIDDEN_MS * 2
    setVisibility('visible')
    render({ enabled: true, lockOnStart: false }) // signed in again
    setVisibility('hidden')
    clock += 1000
    setVisibility('visible')
    expect(result.locked).toBe(false)
  })
})
