/**
 * Hall plan for every member (hall-plan.js) — the pure halves: the GET window,
 * which training notes a caller gets, the contact form's validation and the
 * mail it builds.
 */
import { describe, it, expect } from 'vitest'
import {
  parseRange, shapeTraining, parseContactInput, buildContactEmail, formatWhen,
  normalizeDate, normalizeTime, MAX_MESSAGE, CONTACT_LOCALES,
} from '../hall-plan.js'

const status = (fn) => { try { fn() } catch (e) { return e.status } return null }
const code = (fn) => { try { fn() } catch (e) { return e.code } return null }

describe('normalizeDate / normalizeTime', () => {
  it('keeps real dates and 24h times', () => {
    expect(normalizeDate('2026-11-20')).toBe('2026-11-20')
    expect(normalizeTime('20:00:00')).toBe('20:00')
    expect(normalizeTime('07:30')).toBe('07:30')
  })
  it('refuses the rest', () => {
    for (const bad of ['2026-02-30', '20.11.2026', '', null, '2026-11-20T00:00']) expect(normalizeDate(bad)).toBeNull()
    for (const bad of ['24:00', '7:30', '12:60', 'noon', null]) expect(normalizeTime(bad)).toBeNull()
  })
})

describe('parseRange', () => {
  it('accepts one hall-plan week', () => {
    expect(parseRange('2026-11-16', '2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' })
  })
  it('refuses bad, reversed and too-long windows with a 400', () => {
    expect(status(() => parseRange('2026-11-16', 'x'))).toBe(400)
    expect(status(() => parseRange('2026-11-22', '2026-11-16'))).toBe(400)
    expect(status(() => parseRange('2026-11-01', '2026-11-30'))).toBe(400)
  })
})

describe('shapeTraining', () => {
  const row = { id: 7, team: 92, hall: 3, hall_slot: 11, start_time: '20:00:00', end_time: '22:00:00', date: '2026-11-20', cancelled: true, notes: 'Bring the ball cart', cancel_reason: 'Coach ill' }

  it('keeps notes for a team the caller is on', () => {
    const out = shapeTraining(row, { ownTeamIds: new Set(['92']), isAdmin: false })
    expect(out).toMatchObject({ id: '7', team: '92', hall: '3', hall_slot: '11', notes: 'Bring the ball cart', cancel_reason: 'Coach ill', cancelled: true })
  })
  it('drops notes and the cancel reason for another team, keeps the occupancy', () => {
    const out = shapeTraining(row, { ownTeamIds: new Set(['5']), isAdmin: false })
    expect(out).toMatchObject({ team: '92', start_time: '20:00:00', end_time: '22:00:00', cancelled: true, notes: '', cancel_reason: '' })
  })
  it('an admin sees everything', () => {
    expect(shapeTraining(row, { ownTeamIds: new Set(), isAdmin: true }).notes).toBe('Bring the ball cart')
  })
  it('keeps null links null', () => {
    const out = shapeTraining({ ...row, hall: null, hall_slot: null, team: null }, { ownTeamIds: new Set(), isAdmin: false })
    expect(out).toMatchObject({ hall: null, hall_slot: null, team: null, notes: '' })
  })
})

describe('parseContactInput', () => {
  const ok = { team: '92', hall: 3, date: '2026-11-27', start_time: '20:00:00', end_time: '22:00', slot_type: 'training', message: '  Could we share the hall?\r\nThanks  ' }

  it('cleans a valid message', () => {
    expect(parseContactInput(ok)).toEqual({
      team: 92, hall: 3, date: '2026-11-27', start_time: '20:00', end_time: '22:00',
      slot_type: 'training', message: 'Could we share the hall?\nThanks',
    })
  })
  it('a missing hall is fine, an unknown slot type becomes "other"', () => {
    expect(parseContactInput({ ...ok, hall: null, slot_type: 'party' })).toMatchObject({ hall: null, slot_type: 'other' })
  })
  it('drops control characters but keeps line breaks', () => {
    expect(parseContactInput({ ...ok, message: 'A\u0007B\nC' }).message).toBe('AB\nC')
  })
  it('refuses bad input with a 400 and a stable code', () => {
    expect(code(() => parseContactInput({ ...ok, team: 'x' }))).toBe('bad_team')
    expect(code(() => parseContactInput({ ...ok, hall: -1 }))).toBe('bad_hall')
    expect(code(() => parseContactInput({ ...ok, date: '2026-02-30' }))).toBe('bad_date')
    expect(code(() => parseContactInput({ ...ok, end_time: '25:00' }))).toBe('bad_time')
    expect(code(() => parseContactInput({ ...ok, message: '   ' }))).toBe('empty_message')
    expect(code(() => parseContactInput({ ...ok, message: 'x'.repeat(MAX_MESSAGE + 1) }))).toBe('too_long')
    expect(status(() => parseContactInput(null))).toBe(400)
  })
})

describe('buildContactEmail', () => {
  const input = {
    senderName: 'Anna <b>Muster</b>', senderEmail: 'anna@example.ch', teamName: 'H3', hallName: 'KWI A',
    date: '2026-11-27', start: '20:00', end: '22:00', slotType: 'training',
    message: 'Can we have the hall?\n<script>alert(1)</script>', sport: 'volleyball',
  }

  it('dates are Swiss and the weekday is right', () => {
    expect(formatWhen('de', '2026-11-27', '20:00', '22:00')).toBe('Fr 27.11.2026, 20:00–22:00')
    expect(formatWhen('en', '2026-11-29', '10:00', '12:00')).toBe('Sun 29.11.2026, 10:00–12:00')
  })
  it('every locale builds, with the team in the subject', () => {
    for (const locale of CONTACT_LOCALES) {
      const mail = buildContactEmail(locale, input)
      expect(mail.subject).toContain('H3')
      expect(mail.subject).toMatch(/^[A-Z]/)
      expect(mail.text).toContain('Can we have the hall?')
      expect(mail.text).toContain('anna@example.ch')
    }
  })
  it('escapes the sender-supplied text in the HTML', () => {
    const { html } = buildContactEmail('de', input)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>Muster</b>')
  })
  it('falls back to German for an unknown locale', () => {
    expect(buildContactEmail('xx', input).subject).toBe(buildContactEmail('de', input).subject)
  })
})
