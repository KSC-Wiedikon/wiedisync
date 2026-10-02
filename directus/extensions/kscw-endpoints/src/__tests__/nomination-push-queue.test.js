import { describe, it, expect } from 'vitest'
import { createSerialQueue } from '../nomination-push.js'

// Two teams pressing "Create Einsatzliste" at the same moment must never put two
// logins on the ONE shared Volleymanager account. The queue is the guarantee.
function fakeAccount() {
  let holder = null
  return {
    claim: (who) => { if (holder) return null; holder = who; return () => { if (holder === who) holder = null } },
    take: (who) => { holder = who },
    free: () => { holder = null },
    get holder() { return holder },
  }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms))

describe('createSerialQueue — one Volleymanager push at a time', () => {
  it('two simultaneous requests from different teams run one after the other', async () => {
    const account = fakeAccount()
    let running = 0, maxRunning = 0
    const order = []
    const enqueue = createSerialQueue({
      claim: (job) => account.claim(job.team),
      waitMs: 1000, pollMs: 5,
      run: async (job) => {
        running++; maxRunning = Math.max(maxRunning, running)
        expect(account.holder).toBe(job.team)
        await tick(20)
        order.push(job.team); running--
      },
    })
    expect(enqueue({ team: 'H3' })).toBe(1)
    expect(enqueue({ team: 'D1' })).toBe(2)
    await tick(80)
    expect(maxRunning).toBe(1)
    expect(order).toEqual(['H3', 'D1'])
    expect(account.holder).toBe(null)
  })

  it('waits for an account held by another job (cron / vm_sync) instead of refusing', async () => {
    const account = fakeAccount()
    account.take('vm_sync')
    const ran = []
    const enqueue = createSerialQueue({
      claim: (job) => account.claim(job.team), waitMs: 1000, pollMs: 5,
      run: async (job) => { ran.push(job.team) },
    })
    enqueue({ team: 'H3' })
    await tick(30)
    expect(ran).toEqual([])
    account.free()
    await tick(30)
    expect(ran).toEqual(['H3'])
  })

  it('gives up after waitMs and moves on to the next job', async () => {
    const account = fakeAccount()
    account.take('stuck')
    const gaveUp = []
    const enqueue = createSerialQueue({
      claim: (job) => account.claim(job.team), waitMs: 20, pollMs: 5,
      run: async () => {}, onGiveUp: async (job) => { gaveUp.push(job.team) },
    })
    enqueue({ team: 'H3' }); enqueue({ team: 'D1' })
    await tick(120)
    expect(gaveUp).toEqual(['H3', 'D1'])
  })

  it('a failing job releases the account and does not block the next one', async () => {
    const account = fakeAccount()
    const ran = [], errors = []
    const enqueue = createSerialQueue({
      claim: (job) => account.claim(job.team), waitMs: 1000, pollMs: 5,
      run: async (job) => { if (job.team === 'H3') throw new Error('boom'); ran.push(job.team) },
      onError: async (job) => { errors.push(job.team) },
    })
    enqueue({ team: 'H3' }); enqueue({ team: 'D1' })
    await tick(40)
    expect(errors).toEqual(['H3'])
    expect(ran).toEqual(['D1'])
    expect(account.holder).toBe(null)
  })
})
