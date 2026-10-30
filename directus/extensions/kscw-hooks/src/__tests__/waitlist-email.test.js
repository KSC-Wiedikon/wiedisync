/**
 * Waiting-list emails: the right text per move and language, the guest line only
 * on a lost seat of a guest, and user content escaped in the HTML.
 */
import { describe, it, expect } from 'vitest'
import { waitlistEmailContent } from '../waitlist-email.js'

const base = { activityType: 'training', vars: { team: 'H3', date: '04.11.2026', time: '18:00' }, url: 'https://app/trainings/7' }

describe('waitlistEmailContent', () => {
  it('promoted, German', () => {
    const c = waitlistEmailContent({ ...base, locale: 'de', move: 'confirmed', firstName: 'Anna' })
    expect(c.subject).toBe('WiediSync — Du hast einen Platz: Training H3, 04.11.2026')
    expect(c.text).toContain('Hallo Anna,')
    expect(c.text).toContain('Für Training H3 am 04.11.2026 ist ein Platz frei geworden. Du bist jetzt angemeldet.')
    expect(c.text).toContain('Datum: 04.11.2026, 18:00')
    expect(c.html).toContain('https://app/trainings/7')
  })

  it('a bumped guest is told why; a bumped team player is not', () => {
    const guest = waitlistEmailContent({ ...base, locale: 'en', move: 'waitlisted', isGuest: true })
    expect(guest.subject).toBe('WiediSync — Waiting list: Training H3, 04.11.2026')
    expect(guest.text).toContain('Team players have priority over guest players.')
    const player = waitlistEmailContent({ ...base, locale: 'en', move: 'waitlisted', isGuest: false })
    expect(player.text).not.toContain('priority')
    const promoted = waitlistEmailContent({ ...base, locale: 'en', move: 'confirmed', isGuest: true })
    expect(promoted.text).not.toContain('priority')
  })

  it('events use their title; every language has both texts', () => {
    for (const locale of ['de', 'gsw', 'en', 'fr', 'it']) {
      for (const move of ['confirmed', 'waitlisted']) {
        const c = waitlistEmailContent({ ...base, activityType: 'event', vars: { title: 'Turnier', date: '14.11.2026' }, locale, move })
        expect(c.subject).toContain('Turnier')
        expect(c.subject).toContain('14.11.2026')
        expect(c.text).toContain('Turnier')
      }
    }
  })

  it('escapes an event title in the HTML', () => {
    const c = waitlistEmailContent({ ...base, activityType: 'event', vars: { title: '<b>x</b>', date: '14.11.2026' }, locale: 'en', move: 'confirmed' })
    expect(c.html).not.toContain('<b>x</b>')
    expect(c.html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('unknown locale falls back to German', () => {
    expect(waitlistEmailContent({ ...base, locale: 'xx', move: 'confirmed' }).subject).toContain('Du hast einen Platz')
  })
})
