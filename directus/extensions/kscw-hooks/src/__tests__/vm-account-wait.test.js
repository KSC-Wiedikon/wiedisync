// The result sweep waits for the shared Volleymanager account instead of skipping the hour.
import { describe, expect, it } from 'vitest'

import { waitForVmAccount } from '../vm-account-wait.js'

// A fake clock: sleep() advances it, so no test really waits.
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms) => { t += ms } }
}

describe('waitForVmAccount', () => {
  it('returns at once when the account is free', async () => {
    const c = clock()
    expect(await waitForVmAccount(() => null, c)).toBe(true)
    expect(c.now()).toBe(0)
  })

  it('waits while a short job (the idle Einsatzliste tick) holds it', async () => {
    const c = clock()
    const heldBy = () => (c.now() < 4000 ? 'vm_nomination' : null)
    expect(await waitForVmAccount(heldBy, { ...c, stepMs: 2000 })).toBe(true)
    expect(c.now()).toBe(4000)
  })

  it('gives up after maxMs when the account stays held', async () => {
    const c = clock()
    expect(await waitForVmAccount(() => 'svrz_sync', { ...c, maxMs: 10000, stepMs: 2000 })).toBe(false)
    expect(c.now()).toBe(10000)
  })
})
