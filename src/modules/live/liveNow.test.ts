import { describe, expect, it } from 'vitest'
import { LIVE_STALE_MS, liveHref, pickLiveNow, type NowRow } from './liveNow'
import { historyFilter } from './scoreboard'

const NOW = Date.UTC(2026, 9, 23, 19, 0)
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const row = (over: Partial<NowRow>): NowRow => ({
  channel: 'kscw', status: 'live', sport: 'volleyball', team_a_short: 'KSCW', team_b_short: 'VBCE',
  points_a: 10, points_b: 8, date_updated: ago(30_000), source: null, ...over,
})

describe('pickLiveNow', () => {
  it('nothing live → null; final and idle are not live', () => {
    expect(pickLiveNow([], NOW)).toBeNull()
    expect(pickLiveNow(null, NOW)).toBeNull()
    expect(pickLiveNow([row({ status: 'final' }), row({ channel: 'game-1', status: 'idle' })], NOW)).toBeNull()
  })

  it('a phone-scored game counts, not only the hall board', () => {
    expect(pickLiveNow([row({ channel: 'game-455', source: 'phone' })], NOW)?.channel).toBe('game-455')
  })

  it('drops a row nobody wrote for 20 minutes, keeps one without a timestamp', () => {
    expect(pickLiveNow([row({ date_updated: ago(LIVE_STALE_MS + 1) })], NOW)).toBeNull()
    expect(pickLiveNow([row({ date_updated: null })], NOW)?.channel).toBe('kscw')
  })

  it('the board mirrored into a game row: the game row wins, the board row is dropped', () => {
    const picked = pickLiveNow([
      row({ channel: 'kscw', date_updated: ago(1000) }),
      row({ channel: 'game-455', source: 'board:kscw', date_updated: ago(2000) }),
    ], NOW)
    expect(picked?.channel).toBe('game-455')
  })

  it('a stale mirror does not hide the live board row', () => {
    const picked = pickLiveNow([
      row({ channel: 'kscw', date_updated: ago(1000) }),
      row({ channel: 'game-400', source: 'board:kscw', date_updated: ago(LIVE_STALE_MS + 1) }),
    ], NOW)
    expect(picked?.channel).toBe('kscw')
  })

  it('of two unrelated live rows, the most recently written', () => {
    const picked = pickLiveNow([
      row({ channel: 'game-1', source: 'phone', date_updated: ago(5000) }),
      row({ channel: 'game-2', source: 'phone', date_updated: ago(1000) }),
    ], NOW)
    expect(picked?.channel).toBe('game-2')
  })
})

describe('liveHref', () => {
  it('/live for the hall board, the channel for anything else', () => {
    expect(liveHref('kscw')).toBe('/live')
    expect(liveHref('')).toBe('/live')
    expect(liveHref('game-455')).toBe('/live?channel=game-455')
  })
})

describe('historyFilter', () => {
  it("a game's channel lists that game's matches, a board channel its own log", () => {
    expect(historyFilter('game-455')).toEqual({ game_id: { _eq: 455 } })
    expect(historyFilter('kscw')).toEqual({ channel: { _eq: 'kscw' } })
    expect(historyFilter('game-abc')).toEqual({ channel: { _eq: 'game-abc' } })
  })
})
