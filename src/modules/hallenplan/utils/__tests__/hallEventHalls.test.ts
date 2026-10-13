import { describe, it, expect } from 'vitest'
import { parseNamedKwiHalls, resolveHallEventHalls } from '../virtualSlots'
// The backend decides which halls a calendar entry BOOKS (and whose trainings it
// trims); the Hallenplan decides where it is DRAWN. Two copies of one parser —
// this keeps them from drifting apart.
// @ts-expect-error — plain-JS backend module, no type declarations
import { parseNamedKwiHalls as backendParse } from '../../../../../directus/extensions/kscw-endpoints/src/hall-bookings.js'
import type { Hall, HallEvent } from '../../../../types'

const CASES = [
  'Freundschaftsspiel BB DU18 FIRE - Zürich 93 DU16 (Halle C)',
  'VB D4 vs. Rüschlikon 4 (Halle A+B)',
  'Training (Halle KWI B)',
  'Hallen A, B und C reserviert',
  'Halle A/B',
  'Turnier KWI C',
  'Halle C and B',
  'Halle geschlossen',
  'Halle Resveiert für Prüfung',
  'KWI Turnhalle für Handballturnier Pfadi Gloggi',
  'Halle Abgesagt',
  'Halle Closed',
  'Halle C und Aula',
]

describe('parseNamedKwiHalls — Hallenplan matches the backend', () => {
  it.each(CASES)('%s', (text) => {
    expect(parseNamedKwiHalls(text)).toEqual(backendParse(text))
  })
})

describe('resolveHallEventHalls', () => {
  const halls = [
    { id: '1', name: 'KWI A' }, { id: '2', name: 'KWI B' }, { id: '3', name: 'KWI C' }, { id: '4', name: 'Döltschi 1' },
  ] as Hall[]
  const ev = (title: string) => ({ title, location: '' }) as HallEvent
  it('draws an A+B entry across both halls (the old regex dropped B)', () => {
    expect(resolveHallEventHalls(ev('VB D4 vs. X (Halle A+B)'), halls)).toEqual(['1', '2'])
  })
  it('does not read "Halle Closed" as hall C', () => {
    expect(resolveHallEventHalls(ev('Halle Closed'), halls)).toEqual(['1', '2', '3'])
  })
})
