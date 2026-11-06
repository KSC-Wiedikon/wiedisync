import { describe, expect, it } from 'vitest'
import { onePerFixture } from './onePerFixture'

const row = (id: number, game_id: string | null, type: 'home' | 'away', team: number) => ({ id, game_id, type, team })
const ownIs = (...teams: number[]) => (game: { team: number }) => teams.includes(game.team)

describe('onePerFixture', () => {
  it('keeps the home row of a derby between two other teams', () => {
    const away = row(2, 'vb_1', 'away', 20)
    const home = row(1, 'vb_1', 'home', 10)
    expect(onePerFixture([away, home], ownIs(99))).toEqual([home])
  })

  it("keeps the viewer's own side, even when it is the away row", () => {
    const home = row(1, 'vb_1', 'home', 10)
    const away = row(2, 'vb_1', 'away', 20)
    expect(onePerFixture([home, away], ownIs(20))).toEqual([away])
  })

  it('keeps the home row when the viewer plays for both sides', () => {
    const away = row(2, 'vb_1', 'away', 20)
    const home = row(1, 'vb_1', 'home', 10)
    expect(onePerFixture([away, home], ownIs(10, 20))).toEqual([home])
  })

  it('leaves ordinary games and their order alone', () => {
    const games = [row(3, 'bb_3', 'away', 30), row(1, 'vb_1', 'home', 10), row(2, 'vb_2', 'home', 10)]
    expect(onePerFixture(games, ownIs(10))).toEqual(games)
  })

  it('never merges rows without a game id', () => {
    const games = [row(1, null, 'home', 10), row(2, null, 'home', 20)]
    expect(onePerFixture(games, ownIs())).toEqual(games)
  })
})
