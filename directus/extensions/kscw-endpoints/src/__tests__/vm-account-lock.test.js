import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { claimVmAccount, vmAccountHeldBy, VM_ACCOUNT_KEY, VM_LEASE_MS } from '../vm-account-lock.js'

/**
 * The shared-Volleymanager-account claim, and the one property every caller of
 * it gets wrong the same way.
 *
 * VM keeps the active role per ACCOUNT, not per session, and it survives logout
 * — so two of our jobs overlapping on that account act under each other's role.
 * Under a wrong role VM answers 200 with the WRONG ROWS at least as often as it
 * answers 403, which is why this is guarded rather than left to chance.
 *
 * The nomination push spawns its worker DETACHED. A guard written the obvious
 * way — claim, spawn, release in a `finally` — returns the account while the
 * worker is still logged in, and reads as protected in review while protecting
 * nothing. These tests pin the shape that actually holds: released on the
 * child's `exit`, never before.
 */

beforeEach(() => { globalThis[VM_ACCOUNT_KEY] = null })
afterEach(() => { vi.useRealTimers(); globalThis[VM_ACCOUNT_KEY] = null })

describe('claiming the account', () => {
  it('hands out one claim and refuses the next', () => {
    const release = claimVmAccount('vm_sync')
    expect(release).toBeTypeOf('function')
    expect(claimVmAccount('vm_nomination')).toBeNull()
    expect(vmAccountHeldBy()).toBe('vm_sync')
  })

  it('frees the account on release', () => {
    const release = claimVmAccount('vm_sync')
    release()
    expect(vmAccountHeldBy()).toBeNull()
    expect(claimVmAccount('vm_nomination')).toBeTypeOf('function')
  })

  it("releasing twice cannot free somebody else's claim", () => {
    const stale = claimVmAccount('vm_sync')
    stale()
    const fresh = claimVmAccount('vm_nomination')
    // The overran run calls its release again — the token must not match.
    stale()
    expect(vmAccountHeldBy()).toBe('vm_nomination')
    expect(fresh).toBeTypeOf('function')
  })

  it('a claim nobody released expires, so a dead worker cannot hold it for ever', () => {
    vi.useFakeTimers()
    claimVmAccount('vm_nomination')
    vi.advanceTimersByTime(VM_LEASE_MS + 1000)
    expect(vmAccountHeldBy()).toBeNull()
    expect(claimVmAccount('vm_sync')).toBeTypeOf('function')
  })
})

/**
 * The detached-worker shape, modelled on a fake child. This is the part that
 * was reverted once and is easy to re-break: the release belongs to the child's
 * lifetime, not to the function that spawned it.
 */
describe('a detached worker holds the account until it exits', () => {
  /** The two lines of EventEmitter the guard actually uses. */
  const fakeChild = () => {
    const handlers = []
    return { once: (_e, fn) => handlers.push(fn), exit: () => handlers.forEach((fn) => fn()) }
  }

  it('stays claimed after the spawning function has returned', () => {
    const release = claimVmAccount('vm_nomination')
    const child = fakeChild()
    child.once('exit', () => release())
    // …the tick returns here, milliseconds in, while the worker runs for minutes.
    expect(vmAccountHeldBy()).toBe('vm_nomination')
    child.exit()
    expect(vmAccountHeldBy()).toBeNull()
  })

  it('a batch releases only when the LAST child is gone', () => {
    const release = claimVmAccount('vm_nomination')
    const children = [fakeChild(), fakeChild(), fakeChild()]
    let outstanding = children.length
    for (const c of children) c.once('exit', () => { if (--outstanding === 0) release() })

    children[0].exit()
    expect(vmAccountHeldBy()).toBe('vm_nomination')
    children[1].exit()
    expect(vmAccountHeldBy()).toBe('vm_nomination')
    children[2].exit()
    expect(vmAccountHeldBy()).toBeNull()
  })

  it('a tick that spawned nothing gives the account straight back', () => {
    const release = claimVmAccount('vm_nomination')
    const pending = []
    if (pending.length === 0) release()
    expect(vmAccountHeldBy()).toBeNull()
  })
})
