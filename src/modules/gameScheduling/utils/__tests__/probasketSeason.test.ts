import { describe, it, expect } from 'vitest'
import {
  probasketConfigForSeason,
  probasketCandidateDates,
  probasketLeagueForTeam,
  probasketBlackoutsForCanton,
  blackoutAppliesInCanton,
  PROBASKET_BLACKOUTS_2026_27,
  PROBASKET_KEY_DATES,
  PROBASKET_LEAGUES_2026_27,
  AUTOMATIC_SCHEDULING_BB_SOURCE_IDS,
  GROUP_CODE_TO_LEAGUE,
  BB_SOURCE_LEAGUE_OVERRIDES,
  DEFAULT_PROBASKET_LEAGUE,
  KSCW_CANTON,
  parseYmd,
  toYmd,
  jsDayToDbDow,
  slotsForDate,
  slotEndTime,
  timeToExcelFraction,
  type CandidateDate,
  type ProbasketBlackout,
} from '../probasketSeason'
import { KSCW_TEAM_GROUP } from '../../data/basketballGroups'

const SEASON = '2026/27'

/** Non-null config or an explicit failure — keeps the assertions readable. */
function cfg(opts?: Parameters<typeof probasketConfigForSeason>[1]) {
  const c = probasketConfigForSeason(SEASON, opts)
  if (!c) throw new Error('expected a config for 2026/27')
  return c
}

function dates(opts?: Parameters<typeof probasketConfigForSeason>[1]): CandidateDate[] {
  return probasketCandidateDates(cfg(opts))
}

function labelled(list: CandidateDate[], date: string): CandidateDate | undefined {
  return list.find((d) => d.date === date)
}

function blackoutByLabel(label: string): ProbasketBlackout {
  const b = PROBASKET_BLACKOUTS_2026_27.find((x) => x.label === label)
  if (!b) throw new Error(`no blackout named ${label}`)
  return b
}

describe('probasket league windows 2026/27', () => {
  it('gives the junior 1. Phase exactly the 38 rows of Vorlage_Jugend_allgemein', () => {
    // Sheet "Verfügbarkeiten": first row SA 19 September 2026, last row SO 13 December 2026.
    const list = dates({ league: 'JUN_REG' })
    expect(list).toHaveLength(38)
    expect(list[0].date).toBe('2026-09-19')
    expect(list[list.length - 1].date).toBe('2026-12-13')
  })

  it('gives the 1. Liga Interregional teams the 93 rows of Vorlage_Senior_innen', () => {
    // Sheet "Verfügbarkeiten": first row FR 25 September 2026, last row SO 09 May 2027.
    for (const bbSourceId of AUTOMATIC_SCHEDULING_BB_SOURCE_IDS) {
      const list = dates({ bbSourceId })
      expect(list, `bb_source_id ${bbSourceId}`).toHaveLength(93)
      expect(list[0].date).toBe('2026-09-25')
      expect(list[list.length - 1].date).toBe('2027-05-09')
    }
  })

  it('the senior grid is 55 rows longer than the junior grid (the bug that shipped 38 of 93)', () => {
    expect(dates({ league: 'D1LI' }).length - dates({ league: 'JUN_REG' }).length).toBe(55)
  })

  it('omits the Weihnachtsferien weekends from the senior grid, like the template does', () => {
    const list = dates({ league: 'H1LI' }).map((d) => d.date)
    // Template has rows for 18/19/20 Dec, then jumps straight to 08 Jan.
    expect(list).toContain('2026-12-20')
    expect(list).toContain('2027-01-08')
    for (const gap of ['2026-12-25', '2026-12-26', '2026-12-27', '2027-01-01', '2027-01-02', '2027-01-03']) {
      expect(list, gap).not.toContain(gap)
    }
  })

  it('only ever offers Fri / Sat / Sun', () => {
    for (const league of Object.keys(PROBASKET_LEAGUES_2026_27) as (keyof typeof PROBASKET_LEAGUES_2026_27)[]) {
      for (const d of dates({ league })) {
        expect([5, 6, 0], `${league} ${d.date}`).toContain(d.dow)
        expect(parseYmd(d.date).getDay()).toBe(d.dow)
      }
    }
  })

  it('returns candidate dates sorted and unique', () => {
    const list = dates({ league: 'MIXED' }).map((d) => d.date)
    expect([...list].sort()).toEqual(list)
    expect(new Set(list).size).toBe(list.length)
  })

  it('exposes the league phases verbatim, including the doc-typo corrections', () => {
    // Doc prints "19.04.26" / "26.04.26" / "24.05.26" — typos for 2027.
    const h4 = PROBASKET_LEAGUES_2026_27.H4LR.phases
    expect(h4[0]).toMatchObject({ start: '2026-09-19', end: '2027-04-19' })
    expect(h4[1]).toMatchObject({ start: '2027-04-26', end: '2027-05-24', conditional: true })
    // Doc prints "30.05.26" for the junior 2. Phase Regional — typo for 2027.
    expect(PROBASKET_LEAGUES_2026_27.JUN_REG.phases[1]).toMatchObject({
      start: '2027-01-09',
      end: '2027-05-30',
    })
    // The HU14 Interregional Rückrunde has a start but no printed end.
    expect(PROBASKET_LEAGUES_2026_27.HU14_INTER.phases[1]).toMatchObject({
      start: '2027-01-23',
      end: null,
    })
  })

  it('keeps the association start (19.09) on the 1. Liga phase even though its grid starts 25.09', () => {
    const c = cfg({ league: 'D1LI' })
    expect(c.phases[0].start).toBe('2026-09-19')
    expect(c.vorrundeStart).toBe('2026-09-25')
    expect(c.vorrundeEnd).toBe('2027-05-09')
    expect(c.gridSource).toBe('template')
  })
})

describe('league resolution', () => {
  it('maps KSCW teams through their ProBasket group, not teams.league', () => {
    expect(probasketLeagueForTeam('4445')).toEqual({ league: 'D1LI', source: 'group' })
    expect(probasketLeagueForTeam(1348)).toEqual({ league: 'H1LI', source: 'group' })
    // Team 76 "Herren 2 H3" carries a stale league='H3LS' in prod but is registered H2LRA.
    expect(probasketLeagueForTeam('4829')).toEqual({ league: 'H2LR', source: 'group' })
    expect(probasketLeagueForTeam('7183')).toEqual({ league: 'H4LR', source: 'group' })
    expect(probasketLeagueForTeam('5789')).toEqual({ league: 'JUN_REG', source: 'group' })
    expect(probasketLeagueForTeam('5287')).toEqual({ league: 'KIDS_MINIS', source: 'group' })
  })

  it('pins 7182 as the DU16 team (the "2xDU18" label is a local misnomer)', () => {
    expect(probasketLeagueForTeam('7182')).toEqual({ league: 'JUN_REG', source: 'override' })
  })

  it('falls back to the documented default explicitly, never silently', () => {
    expect(probasketLeagueForTeam(null)).toEqual({ league: DEFAULT_PROBASKET_LEAGUE, source: 'default' })
    expect(probasketLeagueForTeam('nope')).toEqual({ league: DEFAULT_PROBASKET_LEAGUE, source: 'default' })
    // No options at all → the same documented default, so old callers keep today's window.
    expect(cfg().league).toBe(DEFAULT_PROBASKET_LEAGUE)
  })

  it('covers every group code KSCW_TEAM_GROUP currently points at', () => {
    // Guards against basketballGroups.ts renaming a group (e.g. 'DU16 Rookie' →
    // 'DU14/U16 Rookie') and silently dropping a team back to the default window.
    const unmapped = Object.entries(KSCW_TEAM_GROUP).filter(
      ([bbSourceId, code]) => !GROUP_CODE_TO_LEAGUE[code] && !BB_SOURCE_LEAGUE_OVERRIDES[bbSourceId],
    )
    expect(unmapped).toEqual([])
  })

  it('returns null for an unknown season', () => {
    expect(probasketConfigForSeason('2027/28')).toBeNull()
    expect(probasketConfigForSeason(null)).toBeNull()
    expect(probasketConfigForSeason(undefined)).toBeNull()
  })
})

describe('blackouts', () => {
  it('carries all eight published windows with the right kind', () => {
    expect(PROBASKET_BLACKOUTS_2026_27).toHaveLength(8)
    const byLabel = Object.fromEntries(PROBASKET_BLACKOUTS_2026_27.map((b) => [b.label, b]))
    // 'ferien' = no games for interregional + 1./2. Seniorenliga only.
    expect(byLabel['Herbstferien']).toMatchObject({ start: '2026-10-05', end: '2026-10-11', kind: 'ferien' })
    expect(byLabel['Sport / Fasnachtsferien']).toMatchObject({
      start: '2027-01-30',
      end: '2027-02-14',
      kind: 'ferien',
    })
    expect(byLabel['Osterferien (ausser ZH/ZG)']).toMatchObject({
      start: '2027-04-03',
      end: '2027-04-18',
      kind: 'ferien',
    })
    expect(byLabel['Osterferien (ZH/ZG)']).toMatchObject({
      start: '2027-04-24',
      end: '2027-05-02',
      kind: 'ferien',
    })
    // 'sperr' = blocked for all leagues.
    expect(byLabel['Weihnachtsferien']).toMatchObject({ start: '2026-12-21', end: '2027-01-04', kind: 'sperr' })
    expect(byLabel['Final Four ProBasket Jugend']).toMatchObject({
      start: '2027-04-17',
      end: '2027-04-18',
      kind: 'sperr',
    })
    expect(byLabel['ProBasket Classics Final']).toMatchObject({
      start: '2027-04-25',
      end: '2027-04-25',
      kind: 'sperr',
      provisional: true,
    })
    expect(byLabel['Ostern']).toMatchObject({ start: '2027-04-26', end: '2027-04-30', kind: 'sperr' })
  })

  it('is inclusive at both ends of every window', () => {
    for (const b of PROBASKET_BLACKOUTS_2026_27) {
      expect(b.start <= b.end, b.label).toBe(true)
      const dayBefore = toYmd(new Date(parseYmd(b.start).getTime() - 86400000))
      const dayAfter = toYmd(new Date(parseYmd(b.end).getTime() + 86400000))
      const covers = (ymd: string) => ymd >= b.start && ymd <= b.end
      expect(covers(b.start), `${b.label} start`).toBe(true)
      expect(covers(b.end), `${b.label} end`).toBe(true)
      expect(covers(dayBefore), `${b.label} day before`).toBe(false)
      expect(covers(dayAfter), `${b.label} day after`).toBe(false)
    }
  })

  it('annotates the candidate dates at each Herbstferien boundary', () => {
    const list = dates({ league: 'JUN_REG' })
    // 04.10.2026 is the Sunday before, 09-11.10 sit inside, 16.10 is the Friday after.
    expect(labelled(list, '2026-10-04')?.blackout).toBeNull()
    expect(labelled(list, '2026-10-09')?.blackout?.label).toBe('Herbstferien')
    expect(labelled(list, '2026-10-11')?.blackout?.label).toBe('Herbstferien')
    expect(labelled(list, '2026-10-16')?.blackout).toBeNull()
  })

  it('picks the ZH/ZG Osterferien for KSCW and never blocks both windows', () => {
    const zh = probasketBlackoutsForCanton(PROBASKET_BLACKOUTS_2026_27, KSCW_CANTON).map((b) => b.label)
    expect(zh).toContain('Osterferien (ZH/ZG)')
    expect(zh).not.toContain('Osterferien (ausser ZH/ZG)')

    const be = probasketBlackoutsForCanton(PROBASKET_BLACKOUTS_2026_27, 'BE').map((b) => b.label)
    expect(be).toContain('Osterferien (ausser ZH/ZG)')
    expect(be).not.toContain('Osterferien (ZH/ZG)')

    // The two are mutually exclusive in every canton.
    for (const canton of ['ZH', 'ZG', 'BE', 'SG', 'AG']) {
      const easter = probasketBlackoutsForCanton(PROBASKET_BLACKOUTS_2026_27, canton).filter((b) =>
        b.label.startsWith('Osterferien'),
      )
      expect(easter, canton).toHaveLength(1)
    }
    expect(blackoutAppliesInCanton(blackoutByLabel('Herbstferien'), 'ZH')).toBe(true)
    expect(blackoutAppliesInCanton(blackoutByLabel('Osterferien (ZH/ZG)'), 'BE')).toBe(false)
  })

  it('applies the ZH Osterferien (not the other bloc) to a KSCW senior grid', () => {
    const list = dates({ league: 'D1LI' })
    // 03.-18.04 is the non-ZH break — for KSCW those dates are free unless a Sperrdatum hits.
    expect(labelled(list, '2027-04-03')?.blackout).toBeNull()
    expect(labelled(list, '2027-04-10')?.blackout).toBeNull()
    // 24.04 - 02.05 is KSCW's own canton break.
    expect(labelled(list, '2027-04-24')?.blackout?.label).toBe('Osterferien (ZH/ZG)')
    expect(labelled(list, '2027-05-02')?.blackout?.label).toBe('Osterferien (ZH/ZG)')
    expect(labelled(list, '2027-05-07')?.blackout).toBeNull()
  })

  it('lets a Sperrdatum win over an overlapping Ferien window', () => {
    const list = dates({ league: 'D1LI' })
    // 17./18.04 = Final Four ProBasket Jugend (sperr) — blocked for everyone.
    expect(labelled(list, '2027-04-17')?.blackout).toMatchObject({
      label: 'Final Four ProBasket Jugend',
      kind: 'sperr',
    })
    // 25.04 is both the ZH/ZG Osterferien (ferien) and the Classics Final (sperr).
    const classics = labelled(list, '2027-04-25')
    expect(classics?.blackout?.kind).toBe('sperr')
    expect(classics?.blackout?.label).toBe('ProBasket Classics Final')
    expect(classics?.blackouts.map((b) => b.label)).toContain('Osterferien (ZH/ZG)')
    // 30.04 falls in the Ostern Sperrdatum.
    expect(labelled(list, '2027-04-30')?.blackout?.label).toBe('Ostern')
  })

  it('keeps the blocked dates as rows — only the Christmas break loses its rows', () => {
    const list = dates({ league: 'D1LI' }).map((d) => d.date)
    for (const kept of ['2027-04-17', '2027-04-18', '2027-04-25', '2027-04-30']) {
      expect(list, kept).toContain(kept)
    }
  })
})

describe('key dates', () => {
  it('records the ProBasket milestones the UI has to surface', () => {
    expect(PROBASKET_KEY_DATES).toMatchObject({
      availabilityDue: '2026-08-17',
      planPublished: '2026-08-31',
      preSeasonClinic: '2026-09-01',
      spielplansitzung: '2026-09-05',
      onlineSpielplansitzung: '2026-12-16',
    })
    // The junior 2. Phase starts after the online Spielplansitzung.
    expect(PROBASKET_KEY_DATES.onlineSpielplansitzung < PROBASKET_LEAGUES_2026_27.JUN_REG.phases[1].start).toBe(true)
    // Everything has to be filed before the 1. Phase tips off.
    expect(PROBASKET_KEY_DATES.availabilityDue < '2026-09-19').toBe(true)
  })
})

describe('unchanged helpers', () => {
  it('parses and formats local ymd round-trip', () => {
    expect(toYmd(parseYmd('2026-09-19'))).toBe('2026-09-19')
    expect(parseYmd('2026-09-19').getDay()).toBe(6) // Saturday
    expect(parseYmd('2026-09-25').getDay()).toBe(5) // Friday
  })

  it('maps JS weekdays to the DB day_of_week convention', () => {
    expect(jsDayToDbDow(1)).toBe(0) // Monday
    expect(jsDayToDbDow(5)).toBe(4) // Friday
    expect(jsDayToDbDow(0)).toBe(6) // Sunday
  })

  it('keeps the fixed slot grid', () => {
    expect(slotsForDate(5)).toEqual({ times: ['20:00'], halls: ['KWI A', 'KWI B'] })
    expect(slotsForDate(6).times).toEqual(['11:00', '13:30', '16:00', '18:30'])
    expect(slotsForDate(0).halls).toEqual(['KWI A', 'KWI B', 'KWI C'])
    expect(slotsForDate(3)).toEqual({ times: [], halls: [] })
  })

  it('computes export times', () => {
    expect(slotEndTime('20:00')).toBe('22:00')
    expect(slotEndTime('23:30')).toBe('01:30')
    expect(timeToExcelFraction('12:00')).toBeCloseTo(0.5, 10)
  })
})
