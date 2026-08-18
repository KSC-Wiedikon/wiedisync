/**
 * VIS → `members.transfer_status`: season resolution and the write-back rules.
 *
 * Every fixture here is the real prod state of 2026-08-18, the day the
 * reconciliation was written. That day is worth pinning because it contains all
 * three failure modes at once: a season constant that had gone stale (16 while
 * the club worked 17), a member holding a COMPLETED transfer in one season and
 * an in-progress one in the next, and a human 'done' that VIS contradicts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  currentSeasonNo, visStateOf, reconcileDecisions, VIS_ACTOR,
} from '../vis-transfer-sync.mjs'

/** The real GetVolleySeasonList payload, trimmed to the useful end. */
const SEASONS = [
  { no: 14, name: '2023/24' }, { no: 15, name: '2024/25' }, { no: 16, name: '2025/26' },
  { no: 17, name: '2026/27' }, { no: 18, name: '2027/28' },
]

const tr = (o) => ({
  vis_no: 100000, season_no: 17, no_by_season: 1, status_code: 100, status_label: 'in progress',
  percent_complete: 0, player_no: 1, player_first_name: 'A', player_last_name: 'B',
  deleted_at: null, ...o,
})
const mem = (o) => ({
  id: 1, first_name: 'A', last_name: 'B', transfer_status: null,
  vis_player_no: null, vis_player_no_manual: null, ...o,
})

test('currentSeasonNo reads the season by NAME, never by arithmetic', () => {
  // The day the stale constant was found. 16 was pinned; 17 was live.
  assert.equal(currentSeasonNo(SEASONS, new Date('2026-08-18T06:00:00Z')), 17)
})

test('currentSeasonNo rolls over in July, not in September', () => {
  // The 2026/27 transfers were already being worked in August with start_on
  // 14.09.2026 — keying on the playing season would strand the whole summer.
  assert.equal(currentSeasonNo(SEASONS, new Date('2026-06-30T12:00:00Z')), 16)
  assert.equal(currentSeasonNo(SEASONS, new Date('2026-07-01T12:00:00Z')), 17)
  assert.equal(currentSeasonNo(SEASONS, new Date('2027-04-30T12:00:00Z')), 17)
})

test('currentSeasonNo throws rather than guessing when VIS drops the season', () => {
  // A silently wrong season is the exact failure this replaced: an empty
  // transfer list reads as "nothing pending".
  assert.throws(() => currentSeasonNo(SEASONS, new Date('2031-08-18T00:00:00Z')), /no season starting 2031/)
})

test('visStateOf: 100% is complete even while VIS still calls it in progress', () => {
  // All seven transfers the club had cleared by hand sat at 130/100%; not one
  // had reached 200. Requiring 'ended' would have found nothing to do.
  assert.equal(visStateOf([tr({ status_code: 130, percent_complete: 100 })]).state, 'complete')
  assert.equal(visStateOf([tr({ status_code: 200, percent_complete: 100 })]).state, 'complete')
  assert.equal(visStateOf([tr({ status_code: 220, percent_complete: 60 })]).state, 'complete')
})

test('visStateOf: anything short of 100% is in progress', () => {
  assert.equal(visStateOf([tr({ status_code: 100, percent_complete: 60 })]).state, 'in_progress')
  assert.equal(visStateOf([tr({ status_code: 20, percent_complete: 0 })]).state, 'in_progress')
})

test('visStateOf: cancelled, refused and deleted rows are not evidence', () => {
  for (const code of [239, 240, 255]) {
    assert.equal(visStateOf([tr({ status_code: code, percent_complete: 100 })]).state, 'none')
  }
  assert.equal(visStateOf([tr({ status_code: 130, percent_complete: 100, deleted_at: '2026-08-01T00:00:00Z' })]).state, 'none')
})

test('visStateOf: on a resubmission the most advanced live row wins', () => {
  // A fresh draft alongside a finished ITC must not mask it.
  const s = visStateOf([
    tr({ vis_no: 1, status_code: 12, percent_complete: 0 }),
    tr({ vis_no: 2, status_code: 130, percent_complete: 100 }),
  ])
  assert.equal(s.state, 'complete')
  assert.equal(s.row.vis_no, 2)
  // ...and among in-progress rows, the furthest along is the one reported.
  assert.equal(visStateOf([
    tr({ vis_no: 1, percent_complete: 20 }), tr({ vis_no: 2, percent_complete: 60 }),
  ]).row.vis_no, 2)
})

test('a completed transfer marks the member done, with VIS as the attributed actor', () => {
  const { changes } = reconcileDecisions(
    [tr({ vis_no: 121073, no_by_season: 480, status_code: 130, percent_complete: 100, player_no: 243595 })],
    [mem({ id: 21, last_name: 'Bambusch', vis_player_no: 243595 })],
  )
  assert.equal(changes.length, 1)
  assert.deepEqual(
    { memberId: changes[0].memberId, from: changes[0].from, to: changes[0].to },
    { memberId: 21, from: null, to: 'done' },
  )
  assert.equal(VIS_ACTOR, 'FIVB VIS')
})

test('an in-progress transfer opens the worklist item as pending', () => {
  const { changes } = reconcileDecisions(
    [tr({ percent_complete: 60, player_no: 243492 })],
    [mem({ id: 237, last_name: 'Hauck', vis_player_no: 243492 })],
  )
  assert.deepEqual(changes.map((c) => c.to), ['pending'])
})

test("a 'done' VIS contradicts is reverted to pending", () => {
  // Fabian Schenk, 2026-08-18: marked done in wiedisync, submitted 0% in VIS.
  // A done whose ITC has not landed asserts an eligibility the player does not
  // have (FIVB Disciplinary Regulations Art. 11.4).
  const { changes } = reconcileDecisions(
    [tr({ vis_no: 122232, no_by_season: null, status_code: 20, percent_complete: 0, player_no: 243488 })],
    [mem({ id: 97, last_name: 'Schenk', transfer_status: 'done', vis_player_no: 243488 })],
  )
  assert.deepEqual(changes.map((c) => [c.memberId, c.from, c.to]), [[97, 'done', 'pending']])
})

test("'not_needed' is never overwritten — it is the escape hatch from the revert", () => {
  const { changes, conflicts } = reconcileDecisions(
    [tr({ status_code: 130, percent_complete: 100, player_no: 900 })],
    [mem({ id: 63, last_name: 'Kicinski', transfer_status: 'not_needed', vis_player_no: 900 })],
  )
  assert.deepEqual(changes, [])
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].memberId, 63)
})

test('a member with no live VIS row this season is left alone', () => {
  // Ivo Teixeira, 2026-08-18: 2025/26 ended 100%, 2026/27 at 20%. Only the
  // current season is ever passed in, so last season cannot clear this one.
  const { changes } = reconcileDecisions(
    [tr({ vis_no: 121195, no_by_season: 501, percent_complete: 20, player_no: 227819 })],
    [
      mem({ id: 106, last_name: 'Teixeira', transfer_status: 'pending', vis_player_no: 227819 }),
      mem({ id: 176, last_name: 'Delucchi', transfer_status: 'not_needed', vis_player_no: 555 }),
    ],
  )
  assert.deepEqual(changes, [])
})

test('the hand-set link outranks the name-matched one', () => {
  // vis_player_no is rewritten for the whole cohort on every sweep; the manual
  // override is the column that survives it (migration 312).
  const { changes } = reconcileDecisions(
    [tr({ status_code: 130, percent_complete: 100, player_no: 777 })],
    [mem({ id: 5, vis_player_no: 111, vis_player_no_manual: 777 })],
  )
  assert.deepEqual(changes.map((c) => c.memberId), [5])
})

test('two members on one VIS player number is a refusal, not a coin flip', () => {
  const { changes, ambiguous } = reconcileDecisions(
    [tr({ status_code: 130, percent_complete: 100, player_no: 243595 })],
    [mem({ id: 21, vis_player_no: 243595 }), mem({ id: 22, vis_player_no: 243595 })],
  )
  assert.deepEqual(changes, [])
  assert.equal(ambiguous.length, 1)
  assert.deepEqual(ambiguous[0].members.map((m) => m.id), [21, 22])
})

test('a VIS transfer nobody is linked to is reported, never silently dropped', () => {
  const { changes, unmatched } = reconcileDecisions([tr({ player_no: 999 })], [mem({ vis_player_no: 1 })])
  assert.deepEqual(changes, [])
  assert.deepEqual(unmatched.map((u) => u.playerNo), [999])
})

test('the full 2026-08-18 prod state produces exactly one change', () => {
  // 7 done at 100%, 8 pending below it — every one already agreeing with VIS
  // because a human had just worked the list by hand. Only Schenk diverges.
  const VIS = [
    [121073, 480, 130, 100, 243595], [121126, 477, 100, 20, 243602],
    [121145, 483, 130, 100, 243516], [121150, 485, 100, 60, 243492],
    [121153, 487, 130, 100, 243594], [121160, 489, 130, 100, 207172],
    [121164, 490, 130, 100, 243500], [121169, 492, 130, 100, 243534],
    [121173, 494, 100, 60, 243291], [121180, 495, 100, 60, 243289],
    [121186, 500, 100, 20, 243290], [121193, 793, 100, 60, 243491],
    [121195, 501, 100, 20, 227819], [121199, 502, 100, 60, 243574],
    [121203, 1019, 130, 100, 215744], [122232, null, 20, 0, 243488],
  ].map(([vis_no, no_by_season, status_code, percent_complete, player_no]) =>
    tr({ vis_no, no_by_season, status_code, percent_complete, player_no }))

  const MEMBERS = [
    [21, 'done', 243595], [47, 'done', 243516], [531, 'done', 215744], [308, 'done', 243594],
    [629, 'done', 207172], [316, 'done', 243500], [84, 'done', 243534], [97, 'done', 243488],
    [151, 'pending', 243291], [34, 'pending', 243602], [729, 'pending', 243491],
    [9, 'pending', 243289], [237, 'pending', 243492], [71, 'pending', 243574],
    [92, 'pending', 243290], [106, 'pending', 227819],
  ].map(([id, transfer_status, vis_player_no]) => mem({ id, transfer_status, vis_player_no }))

  const { changes, conflicts, ambiguous, unmatched } = reconcileDecisions(VIS, MEMBERS)
  assert.deepEqual(changes.map((c) => [c.memberId, c.from, c.to]), [[97, 'done', 'pending']])
  assert.deepEqual([conflicts, ambiguous, unmatched], [[], [], []])
})
