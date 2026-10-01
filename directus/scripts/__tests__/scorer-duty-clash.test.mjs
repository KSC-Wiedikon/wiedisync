/**
 * Self-claim double booking (scorer-claim.js findDutyClash). Real case:
 * 01.10.2026 a member took the timekeeper seat on two overlapping games.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDutyClash } from '../../extensions/kscw-endpoints/src/scorer-claim.js'

const g = (id, time, seats = {}) => ({ id, date: '2026-10-10', time, ...seats })

test('another seat on the same game clashes', () => {
  const game = g(1, '14:00')
  assert.equal(findDutyClash(game, 7, [g(1, '14:00', { bb_scorer_member: 7 })])?.id, 1)
})

test('overlapping game clashes, back-to-back two hours apart does not', () => {
  const game = g(2, '15:30')
  assert.equal(findDutyClash(game, 7, [g(1, '14:00', { bb_timekeeper_member: '7' })])?.id, 1)
  assert.equal(findDutyClash(g(3, '16:00'), 7, [g(1, '14:00', { bb_timekeeper_member: 7 })]), null)
})

test('other people and unknown times do not clash', () => {
  assert.equal(findDutyClash(g(2, '14:30'), 7, [g(1, '14:00', { scorer_member: 8 })]), null)
  assert.equal(findDutyClash(g(2, null), 7, [g(1, '14:00', { scorer_member: 7 })]), null)
})

import { isJuniorTeamName } from '../../extensions/kscw-endpoints/src/scorer-claim.js'

test('junior = U-age in the team name (same rule as game-scheduling)', () => {
  for (const n of ['HU16', 'DU18 Fire', 'MU10', 'DU12']) assert.equal(isJuniorTeamName(n), true, n)
  for (const n of ['Herren 1', 'Herren 3 (Unicorns)', 'Lions D1', 'Rhinos D3', 'H-Classics 1LR', null]) assert.equal(isJuniorTeamName(n), false, String(n))
})
