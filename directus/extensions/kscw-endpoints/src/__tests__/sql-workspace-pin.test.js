import { describe, it, expect } from 'vitest'
import { createWritePinGate } from '../sql-workspace.js'

const PIN = '123456'

describe('createWritePinGate', () => {
  it('refuses write mode when the server has no valid PIN configured', () => {
    const check = createWritePinGate()
    for (const expected of [undefined, '', '12345', '1234567', 'abcdef']) {
      expect(check('u1', PIN, expected)?.code).toBe('write_pin_unconfigured')
    }
  })

  it('allows the right PIN and refuses a wrong or missing one', () => {
    const check = createWritePinGate()
    expect(check('u1', PIN, PIN)).toBeNull()
    expect(check('u1', '654321', PIN)?.code).toBe('write_pin_invalid')
    expect(check('u1', undefined, PIN)?.code).toBe('write_pin_invalid')
    expect(check('u1', 123456, PIN)).toBeNull()
  })

  it('locks a user out after maxFails wrong PINs, even for the right one, until the lock ends', () => {
    const check = createWritePinGate({ maxFails: 3, lockMs: 1000 })
    expect(check('u1', '000000', PIN, 0)?.code).toBe('write_pin_invalid')
    expect(check('u1', '000000', PIN, 1)?.code).toBe('write_pin_invalid')
    expect(check('u1', '000000', PIN, 2)?.code).toBe('write_pin_locked')
    expect(check('u1', PIN, PIN, 500)?.code).toBe('write_pin_locked')
    expect(check('u2', PIN, PIN, 500)).toBeNull()
    expect(check('u1', PIN, PIN, 1003)).toBeNull()
  })

  it('a correct PIN resets the failure count', () => {
    const check = createWritePinGate({ maxFails: 3, lockMs: 1000 })
    check('u1', '000000', PIN, 0)
    check('u1', '000000', PIN, 1)
    expect(check('u1', PIN, PIN, 2)).toBeNull()
    expect(check('u1', '000000', PIN, 3)?.code).toBe('write_pin_invalid')
  })
})
