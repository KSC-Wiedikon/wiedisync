import { describe, expect, it } from 'vitest'
import type { Game } from '../../../types'
import { isFullyAssigned } from './assignmentStatus'

const game = (fields: Partial<Game>): Game => fields as unknown as Game

describe('isFullyAssigned — HU20 referee + scorer', () => {
  const duties = { referee_duty_team: '7', scorer_duty_team: '7' }

  it('needs both people once the game has a scorer spot', () => {
    expect(isFullyAssigned(game(duties), 'volleyball')).toBe(false)
    expect(isFullyAssigned(game({ ...duties, referee_member: '1' }), 'volleyball')).toBe(false)
    expect(isFullyAssigned(game({ ...duties, scorer_member: '2' }), 'volleyball')).toBe(false)
    expect(isFullyAssigned(game({ ...duties, referee_member: '1', scorer_member: '2' }), 'volleyball')).toBe(true)
  })

  it('a game staffed before the scorer spot owes only its referee', () => {
    expect(isFullyAssigned(game({ referee_duty_team: '7', referee_member: '1' }), 'volleyball')).toBe(true)
  })
})
