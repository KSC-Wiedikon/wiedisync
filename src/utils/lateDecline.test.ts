import { describe, it, expect } from 'vitest'
import { mayDeclineAfterDeadline } from './lateDecline'

const deadline = new Date('2026-11-03T18:00:00Z')

describe('mayDeclineAfterDeadline', () => {
  it('somebody on the waiting list may say No', () => {
    expect(mayDeclineAfterDeadline({ status: 'waitlisted' }, deadline)).toBe(true)
  })

  it('moved up after the deadline (Yes or Maybe) may say No', () => {
    expect(mayDeclineAfterDeadline({ status: 'confirmed', promoted_at: '2026-11-03T19:00:00Z' }, deadline)).toBe(true)
    expect(mayDeclineAfterDeadline({ status: 'tentative', promoted_at: '2026-11-03T18:00:00Z' }, deadline)).toBe(true)
  })

  it('moved up before the deadline, or never: locked like everybody else', () => {
    expect(mayDeclineAfterDeadline({ status: 'confirmed', promoted_at: '2026-11-02T10:00:00Z' }, deadline)).toBe(false)
    expect(mayDeclineAfterDeadline({ status: 'confirmed' }, deadline)).toBe(false)
    expect(mayDeclineAfterDeadline({ status: 'declined', promoted_at: '2026-11-03T19:00:00Z' }, deadline)).toBe(false)
  })

  it('no row or no deadline: nothing to unlock', () => {
    expect(mayDeclineAfterDeadline(null, deadline)).toBe(false)
    expect(mayDeclineAfterDeadline({ status: 'waitlisted' }, null)).toBe(false)
  })
})
