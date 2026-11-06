import { describe, expect, it } from 'vitest'
import type { Game } from '../../../types'
import { isFullyAssigned } from './assignmentStatus'

const game = (fields: Partial<Game>): Game => fields as unknown as Game

describe('isFullyAssigned — HU20 referee + Täfeler', () => {
  const duties = { referee_duty_team: '7', scoreboard_duty_team: '7' }

  it('needs both people once the game has a Täfeler spot', () => {
    expect(isFullyAssigned(game(duties), 'volleyball')).toBe(false)
    expect(isFullyAssigned(game({ ...duties, referee_member: '1' }), 'volleyball')).toBe(false)
    expect(isFullyAssigned(game({ ...duties, scoreboard_member: '2' }), 'volleyball')).toBe(false)
    expect(isFullyAssigned(game({ ...duties, referee_member: '1', scoreboard_member: '2' }), 'volleyball')).toBe(true)
  })

  it('a game staffed before the Täfeler spot owes only its referee', () => {
    expect(isFullyAssigned(game({ referee_duty_team: '7', referee_member: '1' }), 'volleyball')).toBe(true)
  })
})
