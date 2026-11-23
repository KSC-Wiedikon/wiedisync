import { describe, it, expect } from 'vitest'
import {
  HALL_COMBO_AB, courtLabel, hallIdList, hasSyncedHall, isHallSourceChange, overridePayload, pickerValue, syncSourceKey,
} from './hallSource'

const halls = [
  { id: '1', name: 'KWI A' },
  { id: '2', name: 'KWI B' },
  { id: '3', name: 'KWI C' },
  { id: '4', name: 'Döltschi' },
]

describe('hasSyncedHall', () => {
  it('a Volleymanager or Basketplan home game has one', () => {
    expect(hasSyncedHall({ source: 'swiss_volley', type: 'home', hall: '1' })).toBe(true)
    expect(hasSyncedHall({ source: 'basketplan', type: 'home', hall: '' })).toBe(true)
  })

  it('a derby\'s away row carries our hall too', () => {
    expect(hasSyncedHall({ source: 'swiss_volley', type: 'away', hall: '1' })).toBe(true)
  })

  it('an ordinary away game, a game entered in the app or a tournament has none', () => {
    expect(hasSyncedHall({ source: 'swiss_volley', type: 'away', hall: '' })).toBe(false)
    expect(hasSyncedHall({ source: 'manual', type: 'home', hall: '1' })).toBe(false)
    expect(hasSyncedHall({ source: 'basketplan_tournament', type: 'away', hall: '' })).toBe(false)
    expect(hasSyncedHall(null)).toBe(false)
  })
})

describe('labels', () => {
  it('syncSourceKey names the source', () => {
    expect(syncSourceKey('basketplan')).toBe('hallSourceFromBasketplan')
    expect(syncSourceKey('swiss_volley')).toBe('hallSourceFromVm')
  })

  it('courtLabel joins a combo and ignores a repeated primary', () => {
    expect(courtLabel('1', ['2'], halls)).toBe('KWI A + KWI B')
    expect(courtLabel({ id: 3, name: 'KWI C' }, null, halls)).toBe('KWI C')
    expect(courtLabel('1', '["1","2"]', halls)).toBe('KWI A + KWI B')
    expect(courtLabel(null, null, halls)).toBe('')
  })

  it('hallIdList reads every shape', () => {
    expect(hallIdList([2, '3', { id: 4 }])).toEqual(['2', '3', '4'])
    expect(hallIdList('["2"]')).toEqual(['2'])
    expect(hallIdList('{2}')).toEqual([])
    expect(hallIdList(undefined)).toEqual([])
  })
})

describe('picker', () => {
  it('pickerValue spots the KWI A + B combo', () => {
    expect(pickerValue('1', ['2'], '1', '2')).toBe(HALL_COMBO_AB)
    expect(pickerValue('2', ['1'], '1', '2')).toBe('2')
    expect(pickerValue('3', [], '1', '2')).toBe('3')
    expect(pickerValue({ id: 1 }, null, '1', '2')).toBe('1')
  })

  it('overridePayload sends the court set the server expects', () => {
    expect(overridePayload(HALL_COMBO_AB, '1', '2')).toEqual({ override: true, hall: 1, additional_halls: [2] })
    expect(overridePayload('3', '1', '2')).toEqual({ override: true, hall: 3, additional_halls: [] })
    expect(overridePayload('', '1', '2')).toBeNull()
    expect(overridePayload(HALL_COMBO_AB)).toBeNull()
  })

  it('isHallSourceChange: saving what is there already is no change', () => {
    const onSync = { hall: '1', additional_halls: null, hall_override: false }
    const overwritten = { hall: '3', additional_halls: null, hall_override: true }
    expect(isHallSourceChange(onSync, 'sync', '')).toBe(false)
    expect(isHallSourceChange(overwritten, 'sync', '')).toBe(true)
    expect(isHallSourceChange(onSync, 'override', '1')).toBe(true) // pinning still switches
    expect(isHallSourceChange(overwritten, 'override', '3')).toBe(false)
    expect(isHallSourceChange(overwritten, 'override', '4')).toBe(true)
  })
})
