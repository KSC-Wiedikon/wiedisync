import { describe, it, expect } from 'vitest'
import { eventTypeLabelKey } from '../eventTypeLabel'
import type { Event } from '../../../types'
import en from '../../../i18n/locales/en/calendar'
import de from '../../../i18n/locales/de/calendar'
import gsw from '../../../i18n/locales/gsw/calendar'
import fr from '../../../i18n/locales/fr/calendar'
// ⚠ Aliased: a bare `it` would shadow vitest's own `it`.
import itIT from '../../../i18n/locales/it/calendar'

/** Every value the column's CHECK admits. Keep in step with `Event['event_type']`. */
const ALL_TYPES: Event['event_type'][] = [
  'verein', 'social', 'meeting', 'tournament', 'trainingsweekend', 'friendly', 'other',
]

describe('eventTypeLabelKey', () => {
  it('maps the type that prompted this', () => {
    expect(eventTypeLabelKey('friendly')).toBe('eventTypeFriendly')
  })

  it('maps every type in the enum', () => {
    for (const type of ALL_TYPES) {
      expect(eventTypeLabelKey(type)).toBeTruthy()
    }
  })

  // ⚠ Deliberately null, not 'eventTypeOther': calling an unset type "Other"
  // asserts something the data never said. Callers render the bare title.
  it('returns null for an unset type rather than labelling it "Other"', () => {
    expect(eventTypeLabelKey(null)).toBeNull()
    expect(eventTypeLabelKey(undefined)).toBeNull()
  })

  it('returns null for a value the enum has outgrown', () => {
    expect(eventTypeLabelKey('camp' as Event['event_type'])).toBeNull()
  })
})

// The whole point of re-using `calendar:eventType*` is that the strings already
// exist everywhere. This fails the moment someone adds an event type and
// translates it in English only — which would otherwise ship as a raw key
// ("eventTypeCamp") in the four other locales.
describe('every label key resolves in all five locales', () => {
  const bundles: Array<[string, Record<string, string>]> = [
    ['en', en], ['de', de], ['gsw', gsw], ['fr', fr], ['it', itIT],
  ]

  for (const [locale, bundle] of bundles) {
    it(locale, () => {
      for (const type of ALL_TYPES) {
        const key = eventTypeLabelKey(type)
        expect(key, `no key for "${type}"`).toBeTruthy()
        expect(bundle[key!], `${locale}/calendar.ts is missing "${key}"`).toBeTruthy()
      }
    })
  }
})
