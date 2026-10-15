// Scheduling / events / basketball values (migration 420): slugs in the DB, the
// German spellings still accepted on the way in.
import { describe, it, expect } from 'vitest'
import {
  normalizeEventType, eventTypeToLegacy, normalizeSlotSource, normalizeTeamSlotConfig,
  normalizeBbSlotConfig, bbTournamentListStatus, normalizeSchedulingPayload,
} from '../scheduling-values.js'

describe('scheduling values', () => {
  it('event type', () => {
    expect(normalizeEventType('verein')).toBe('club')
    expect(normalizeEventType('Trainingsweekend')).toBe('training_weekend')
    expect(normalizeEventType('club')).toBe('club')
    expect(normalizeEventType('friendly')).toBe('friendly')
    expect(normalizeEventType('')).toBeNull()
    // The website compat: the slugs go back out in the old spelling, the rest as is.
    expect(eventTypeToLegacy('club')).toBe('verein')
    expect(eventTypeToLegacy('training_weekend')).toBe('trainingsweekend')
    expect(eventTypeToLegacy('tournament')).toBe('tournament')
    expect(eventTypeToLegacy(null)).toBeNull()
  })

  it('slot source', () => {
    expect(normalizeSlotSource('spielsamstag')).toBe('game_saturday')
    expect(normalizeSlotSource('spielhalle')).toBe('game_hall')
    expect(normalizeSlotSource('spielsonntag')).toBe('game_sunday')
    expect(normalizeSlotSource('hall_slot')).toBe('hall_slot')
    expect(normalizeTeamSlotConfig({ 4: { source: 'spielsamstag' }, 92: { sources: ['hall_slot', 'spielsamstag'] }, 7: null }))
      .toEqual({ 4: { source: 'game_saturday' }, 92: { sources: ['hall_slot', 'game_saturday'] }, 7: null })
  })

  it('bb_slot_config keys and statuses', () => {
    const old = { version: 1, max_weekends: 10, spielsamstage: [{ date: '2026-12-05', status: 'fraglich' }, { date: '2027-04-10', status: 'bei_bedarf', note: 'x' }], spielsamstage_hard: true }
    expect(normalizeBbSlotConfig(old)).toEqual({
      version: 1, max_weekends: 10, game_saturdays_hard: true,
      game_saturdays: [{ date: '2026-12-05', status: 'uncertain' }, { date: '2027-04-10', status: 'if_needed', note: 'x' }],
    })
    // A stale screen spreading a fresh row: the new key wins, the old one is dropped.
    expect(normalizeBbSlotConfig({ game_saturdays: [{ date: 'a', status: 'given' }], spielsamstage: [] }))
      .toEqual({ game_saturdays: [{ date: 'a', status: 'given' }] })
    // JSON text is accepted too.
    expect(normalizeBbSlotConfig('{"spielsamstage_hard":false}')).toEqual({ game_saturdays_hard: false })
  })

  it('Basketplan list status', () => {
    expect(bbTournamentListStatus('Anmelden')).toBe('open')
    expect(bbTournamentListStatus('Anmeldefrist abgelaufen')).toBe('closed')
    expect(bbTournamentListStatus('Anmeldung geschlossen')).toBe('closed')
    expect(bbTournamentListStatus('open')).toBe('open')
    expect(bbTournamentListStatus('closed')).toBe('closed')
    expect(bbTournamentListStatus('Demnächst')).toBeNull()
    expect(bbTournamentListStatus('')).toBeNull()
  })

  it('items-API payloads from a cached bundle', () => {
    expect(normalizeSchedulingPayload('events', { event_type: 'verein', title: 'GV' })).toEqual({ event_type: 'club', title: 'GV' })
    expect(normalizeSchedulingPayload('basketball_team_rules', { ferien_hard: true })).toEqual({ school_holidays_hard: true })
    expect(normalizeSchedulingPayload('basketball_groups', { modus: 'Hin- und Rückrunde' })).toEqual({ mode: 'Hin- und Rückrunde' })
    expect(normalizeSchedulingPayload('game_scheduling_seasons', { spielsamstage: [] })).toEqual({ game_saturdays: [] })
    expect(normalizeSchedulingPayload('game_scheduling_slots', { source: 'spielhalle' })).toEqual({ source: 'game_hall' })
    expect(normalizeSchedulingPayload('game_scheduling_seasons', { team_slot_config: { 3: { sources: ['spielsamstag'] } } }))
      .toEqual({ team_slot_config: { 3: { sources: ['game_saturday'] } } })
    // Untouched collections and shapes pass through.
    expect(normalizeSchedulingPayload('members', { modus: 1 })).toEqual({ modus: 1 })
    expect(normalizeSchedulingPayload('events', [1, 2])).toEqual([1, 2])
  })
})
