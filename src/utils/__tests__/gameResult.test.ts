import { describe, expect, it } from 'vitest'
import {
  applyProvisionalToRankings, dedupeProvisionalGames, displayResult, pickResultPrefill, setsEqual, validateSets, vmReasonKey,
} from '../gameResult'
import type { Ranking } from '../../types'

const S = (...pairs: Array<[number, number]>) => pairs.map(([home, away]) => ({ home, away }))

describe('displayResult', () => {
  const base = { home_score: 0, away_score: 0, sets_json: null }

  it('official wins once the game is completed, even with a provisional result', () => {
    const r = displayResult({
      ...base, status: 'completed', home_score: 3, away_score: 1, sets_json: S([25, 20], [20, 25], [25, 18], [25, 22]),
      provisional_home_score: 3, provisional_away_score: 2, provisional_source: 'own',
    })
    expect(r).toMatchObject({ kind: 'official', home: 3, away: 1, source: null })
    expect(r.sets).toHaveLength(4)
  })

  it('shows the provisional result while not official', () => {
    const r = displayResult({
      ...base, status: 'scheduled',
      provisional_home_score: 0, provisional_away_score: 3, provisional_sets_json: S([20, 25], [18, 25], [23, 25]), provisional_source: 'opponent',
    })
    expect(r).toMatchObject({ kind: 'provisional', home: 0, away: 3, source: 'opponent' })
    expect(r.sets).toEqual(S([20, 25], [18, 25], [23, 25]))
  })

  it('is none for a postponed or cancelled game, even with a provisional result', () => {
    const prov = { provisional_home_score: 3, provisional_away_score: 0, provisional_sets_json: S([25, 20], [25, 20], [25, 20]), provisional_source: 'own' as const }
    expect(displayResult({ ...base, status: 'postponed', ...prov })).toMatchObject({ kind: 'none', home: null, sets: [] })
    expect(displayResult({ ...base, status: 'cancelled', ...prov })).toMatchObject({ kind: 'none', home: null, sets: [] })
  })

  it('is none without either', () => {
    expect(displayResult({ ...base, status: 'scheduled' })).toMatchObject({ kind: 'none', home: null, away: null, sets: [] })
    expect(displayResult({ ...base, status: 'scheduled', provisional_home_score: null })).toMatchObject({ kind: 'none' })
  })
})

describe('validateSets', () => {
  it('accepts a 3:0 and a 3:2 with a 15-point decider', () => {
    expect(validateSets(S([25, 20], [25, 18], [26, 24]), 3)).toMatchObject({ ok: true, home: 3, away: 0 })
    expect(validateSets(S([25, 20], [20, 25], [25, 18], [22, 25], [15, 13]), 3)).toMatchObject({ ok: true, home: 3, away: 2 })
  })

  it('accepts best-of-3 with a 15-point third set', () => {
    expect(validateSets(S([25, 20], [20, 25], [15, 12]), 2)).toMatchObject({ ok: true, home: 2, away: 1 })
  })

  it('derives the format when unknown', () => {
    expect(validateSets(S([25, 20], [25, 20]), null)).toMatchObject({ ok: true, home: 2, away: 0 })
    expect(validateSets(S([25, 20], [25, 20], [25, 20]), null)).toMatchObject({ ok: true, home: 3, away: 0 })
  })

  it('refuses empty and too many sets', () => {
    expect(validateSets([], 3)).toMatchObject({ ok: false, error: 'no_sets' })
    expect(validateSets(S([25, 20], [20, 25], [25, 20], [20, 25], [15, 10], [25, 1]), 3).error).toBe('too_many_sets')
    expect(validateSets(S([25, 20], [20, 25], [15, 10], [25, 20]), 2).error).toBe('too_many_sets')
  })

  it('refuses non-integers, out-of-range and ties', () => {
    expect(validateSets(S([25.5, 20]), 3)).toMatchObject({ error: 'not_integer', set: 1 })
    expect(validateSets(S([25, 20], [100, 98]), 3)).toMatchObject({ error: 'out_of_range', set: 2 })
    expect(validateSets(S([25, 20], [-1, 25]), 3)).toMatchObject({ error: 'out_of_range', set: 2 })
    expect(validateSets(S([25, 25]), 3)).toMatchObject({ error: 'set_tied', set: 1 })
  })

  it('refuses a short set and a one-point margin', () => {
    expect(validateSets(S([24, 20], [25, 20], [25, 20]), 3)).toMatchObject({ error: 'set_too_short', set: 1 })
    expect(validateSets(S([25, 20], [25, 24], [25, 20]), 3)).toMatchObject({ error: 'set_margin', set: 2 })
    // 15 is only enough in the deciding set.
    expect(validateSets(S([15, 10], [25, 20], [25, 20]), 3)).toMatchObject({ error: 'set_too_short', set: 1 })
    expect(validateSets(S([25, 20], [20, 25], [25, 20], [20, 25], [14, 12]), 3)).toMatchObject({ error: 'set_too_short', set: 5 })
  })

  it('refuses an undecided match and a set after the decision', () => {
    expect(validateSets(S([25, 20], [25, 20]), 3)).toMatchObject({ ok: false, error: 'not_decided' })
    expect(validateSets(S([25, 20], [25, 20], [20, 25]), 2)).toMatchObject({ error: 'set_after_decided', set: 3 })
    expect(validateSets(S([25, 20], [25, 20], [25, 20], [20, 25]), 3)).toMatchObject({ error: 'set_after_decided', set: 4 })
  })
})

describe('setsEqual', () => {
  it('compares in order', () => {
    expect(setsEqual(S([25, 20], [25, 18]), S([25, 20], [25, 18]))).toBe(true)
    expect(setsEqual(S([25, 20], [25, 18]), S([25, 18], [25, 20]))).toBe(false)
    expect(setsEqual(S([25, 20]), S([25, 20], [25, 18]))).toBe(false)
    expect(setsEqual(null, [])).toBe(false)
  })
})

describe('applyProvisionalToRankings', () => {
  const row = (id: string, team_name: string, rank: number, points: number, extra: Partial<Ranking> = {}): Ranking => ({
    id, team_id: `vb_${id}`, team: '', team_name, league: '2. Liga Damen', rank, played: 4, won: points / 3, lost: 4 - points / 3,
    wins_clear: points / 3, wins_narrow: 0, defeats_clear: 4 - points / 3, defeats_narrow: 0,
    sets_won: 6, sets_lost: 6, points_won: 500, points_lost: 500, points, season: '2026/27', updated_at: '', ...extra,
  } as Ranking)
  const rows = [row('1', 'VBC Alpha', 1, 9), row('2', 'KSC Wiedikon D2', 2, 6), row('3', 'Volley Beta', 3, 3)]
  const game = (over: Record<string, unknown> = {}) => ({
    id: 'g1', status: 'scheduled' as const, home_team: 'KSC Wiedikon D2', away_team: 'VBC Alpha', league: '2. Liga Damen',
    provisional_home_score: 3, provisional_away_score: 2,
    provisional_sets_json: S([25, 20], [20, 25], [25, 18], [22, 25], [15, 13]),
    provisional_source: 'own' as const,
    ...over,
  })

  it('applies a narrow win (2/1), balls and sets, and re-ranks', () => {
    const out = applyProvisionalToRankings(rows, [game()])
    const d2 = out.find((r) => r.team_name === 'KSC Wiedikon D2')!
    const alpha = out.find((r) => r.team_name === 'VBC Alpha')!
    expect(d2).toMatchObject({ points: 8, played: 5, won: 3, sets_won: 9, sets_lost: 8, wins_narrow: 1, provisional: true })
    expect(d2.points_won).toBe(500 + 25 + 20 + 25 + 22 + 15)
    expect(alpha).toMatchObject({ points: 10, played: 5, lost: 2, defeats_narrow: 1, rank: 1, provisional: true })
    expect(d2.rank).toBe(2)
    expect(out.find((r) => r.team_name === 'Volley Beta')!.provisional).toBeUndefined()
    // Inputs untouched.
    expect(rows[1].points).toBe(6)
  })

  it('a clear win is 3/0 and can move a team up', () => {
    const out = applyProvisionalToRankings(rows, [game({
      home_team: 'Volley Beta', away_team: 'KSC Wiedikon D2',
      provisional_home_score: 3, provisional_away_score: 1, provisional_sets_json: S([25, 20], [20, 25], [25, 18], [25, 22]),
    })])
    const beta = out.find((r) => r.team_name === 'Volley Beta')!
    expect(beta).toMatchObject({ points: 6, won: 2, wins_clear: 2 })
    // Tie on points and wins with D2 → set quotient decides (Beta 9:7 > D2 7:9).
    expect(beta.rank).toBe(2)
    expect(out.find((r) => r.team_name === 'KSC Wiedikon D2')!.rank).toBe(3)
  })

  it('skips official games, unmatched teams, and returns rows unchanged', () => {
    const out = applyProvisionalToRankings(rows, [
      game({ status: 'completed' }),
      game({ away_team: 'Somebody Else' }),
      game({ provisional_home_score: null, provisional_away_score: null }),
    ])
    expect(out.map((r) => [r.team_name, r.rank, r.points, r.provisional])).toEqual([
      ['VBC Alpha', 1, 9, undefined], ['KSC Wiedikon D2', 2, 6, undefined], ['Volley Beta', 3, 3, undefined],
    ])
  })

  it('matches names ignoring case, accents and spacing', () => {
    const out = applyProvisionalToRankings(rows, [game({ home_team: 'ksc  wiedikon d2', away_team: 'VBC Alphá' })])
    expect(out.find((r) => r.team_name === 'KSC Wiedikon D2')!.provisional).toBe(true)
  })

  it('applies only to the group whose league equals the game league — no fallback', () => {
    const other = rows.map((r) => ({ ...r, id: `x${r.id}`, league: 'Züri Cup Damen' }))
    const out = applyProvisionalToRankings([...rows, ...other], [game({ league: '3. Liga Damen' })])
    expect(out.some((r) => r.provisional)).toBe(false)
  })

  it('skips cup games by league and by cup round', () => {
    const cupRows = rows.map((r) => ({ ...r, league: 'Züri Cup' }))
    expect(applyProvisionalToRankings(cupRows, [game({ league: 'Züri Cup' })]).some((r) => r.provisional)).toBe(false)
    expect(applyProvisionalToRankings(rows, [game({ round: 'Mobiliar Cup 1/16' })]).some((r) => r.provisional)).toBe(false)
    // An ordinary round label still counts.
    expect(applyProvisionalToRankings(rows, [game({ round: 'Runde 5' })]).some((r) => r.provisional)).toBe(true)
  })

  it('skips a postponed game', () => {
    expect(applyProvisionalToRankings(rows, [game({ status: 'postponed' })]).some((r) => r.provisional)).toBe(false)
  })
})

describe('dedupeProvisionalGames', () => {
  const g = (id: string, game_id: string | undefined, provisional_source: string, provisional_at: string) =>
    ({ id, game_id, provisional_source, provisional_at, status: 'scheduled' as const, home_team: 'A', away_team: 'B', league: 'L' }) as Parameters<typeof dedupeProvisionalGames>[0][number]

  it('keeps one row per game_id, by source then newest', () => {
    const out = dedupeProvisionalGames([
      g('1', 'X', 'opponent', '2026-09-28T20:00:00Z'),
      g('2', 'X', 'own', '2026-09-27T20:00:00Z'),
      g('3', 'Y', 'own', '2026-09-27T20:00:00Z'),
      g('4', 'Y', 'own', '2026-09-28T20:00:00Z'),
      g('5', 'Z', 'vm_official', '2026-09-27T20:00:00Z'),
      g('6', 'Z', 'confirmed', '2026-09-26T20:00:00Z'),
      g('7', undefined, 'own', '2026-09-26T20:00:00Z'),
    ])
    expect(out.map((x) => x.id).sort()).toEqual(['2', '4', '6', '7'])
  })

  it('a derby counts once in the standings', () => {
    const rows = [
      { id: '1', team_id: 'vb_1', team: '', team_name: 'KSC Wiedikon D1', league: 'L', rank: 1, played: 0, won: 0, lost: 0, sets_won: 0, sets_lost: 0, points_won: 0, points_lost: 0, points: 0, season: '', updated_at: '' },
      { id: '2', team_id: 'vb_2', team: '', team_name: 'KSC Wiedikon D2', league: 'L', rank: 2, played: 0, won: 0, lost: 0, sets_won: 0, sets_lost: 0, points_won: 0, points_lost: 0, points: 0, season: '', updated_at: '' },
    ] as unknown as Ranking[]
    const both = [1, 2].map((n) => ({
      id: `g${n}`, game_id: 'D', status: 'scheduled' as const, home_team: 'KSC Wiedikon D1', away_team: 'KSC Wiedikon D2', league: 'L',
      provisional_home_score: 3, provisional_away_score: 0, provisional_sets_json: S([25, 20], [25, 20], [25, 20]), provisional_source: 'own' as const,
      provisional_at: `2026-09-2${n}T20:00:00Z`,
    }))
    const out = applyProvisionalToRankings(rows, dedupeProvisionalGames(both))
    expect(out.find((r) => r.team_name === 'KSC Wiedikon D1')).toMatchObject({ played: 1, points: 3 })
  })
})

describe('pickResultPrefill', () => {
  const theirs = S([25, 20], [25, 20], [25, 20])
  const ours = S([25, 20], [20, 25], [25, 20], [25, 20])

  it('prefers our own differing report over the opponent\'s', () => {
    expect(pickResultPrefill({ opponent: { sets: theirs }, own: null, provisional: { sets: ours, source: 'own' }, live: null }))
      .toEqual({ sets: ours, from: 'own' })
    expect(pickResultPrefill({ opponent: { sets: theirs }, own: { sets: ours }, provisional: { sets: theirs, source: 'opponent' }, live: null }))
      .toEqual({ sets: ours, from: 'own' })
  })

  it('uses the opponent report when ours matches or there is none', () => {
    expect(pickResultPrefill({ opponent: { sets: theirs }, own: { sets: theirs }, provisional: null, live: null }))
      .toEqual({ sets: theirs, from: 'opponent' })
    expect(pickResultPrefill({ opponent: { sets: theirs }, own: null, provisional: { sets: theirs, source: 'opponent' }, live: null }))
      .toEqual({ sets: theirs, from: 'opponent' })
  })

  it('falls back to the provisional, then the final live score, then nothing', () => {
    expect(pickResultPrefill({ opponent: null, own: null, provisional: { sets: ours, source: 'own' }, live: null })).toEqual({ sets: ours, from: null })
    expect(pickResultPrefill({ opponent: null, own: null, provisional: null, live: { sets: ours, final: true } })).toEqual({ sets: ours, from: 'live' })
    expect(pickResultPrefill({ opponent: null, own: null, provisional: null, live: { sets: ours, final: false } })).toEqual({ sets: null, from: null })
  })
})

describe('vmReasonKey', () => {
  it('maps known codes, folds worker_exit_*, and never passes raw text through', () => {
    expect(vmReasonKey(null)).toBeNull()
    expect(vmReasonKey('')).toBeNull()
    expect(vmReasonKey('derby')).toBe('result_reason_derby')
    expect(vmReasonKey('vm_not_configured')).toBe('result_reason_vm_not_configured')
    expect(vmReasonKey('queued_window')).toBe('result_reason_queued_window')
    expect(vmReasonKey('worker_exit_1')).toBe('result_reason_worker_exit')
    expect(vmReasonKey('worker_exit_137')).toBe('result_reason_worker_exit')
    expect(vmReasonKey('TypeError: cannot read x of undefined')).toBe('result_reason_unknown')
  })

  it('maps the worker\'s suffixed party_changed message (vm-push-result.mjs)', () => {
    expect(vmReasonKey('party_changed (hometeam → awayteam)')).toBe('result_reason_party_changed')
    expect(vmReasonKey('party_changed (hometeam → null)')).toBe('result_reason_party_changed')
    expect(vmReasonKey('party_changed')).toBe('result_reason_party_changed')
  })
})

describe('vmReasonKey ↔ locales', () => {
  it('every key it can return exists in all five locales', async () => {
    const codes = [
      'derby', 'home_team_reports', 'not_reportable', 'no_vm_game', 'vm_not_configured', 'dry_run', 'worker_lost',
      'opponent_differs', 'spawn_failed', 'queued_window', 'party_changed', 'timeout', 'worker_exit_1', 'something_new',
    ]
    for (const loc of ['en', 'de', 'fr', 'gsw', 'it']) {
      const dict = (await import(`../../i18n/locales/${loc}/live.ts`)).default as Record<string, string>
      for (const c of codes) expect(dict[vmReasonKey(c)!], `${loc}: ${c}`).toBeTruthy()
      expect(dict.result_replacesOurs, `${loc}: result_replacesOurs`).toBeTruthy()
    }
  })
})
