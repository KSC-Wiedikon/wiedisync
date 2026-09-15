import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWanted, planTeam, staticIdFromTeamId } from '../vm-team-players.mjs'

test('staticIdFromTeamId: vb_<n> → n, placeholders and basketball → null', () => {
  assert.equal(staticIdFromTeamId('vb_1393'), 1393)
  assert.equal(staticIdFromTeamId('vb_541'), 541)
  assert.equal(staticIdFromTeamId('vb_00001'), null, 'zero-padded = our placeholder, not VM team #1')
  assert.equal(staticIdFromTeamId('vb_00000'), null)
  assert.equal(staticIdFromTeamId('bb_166'), null)
  assert.equal(staticIdFromTeamId(null), null)
  assert.equal(staticIdFromTeamId(''), null)
})

const ROWS = [
  { team_db_id: 80, team_id: 'vb_1393', team_name: 'D1', member_id: 1, license_nr: '100', first_name: 'Anna', last_name: 'A' },
  { team_db_id: 80, team_id: 'vb_1393', team_name: 'D1', member_id: 2, license_nr: ' 200 ', first_name: 'Bea', last_name: 'B' },
  { team_db_id: 80, team_id: 'vb_1393', team_name: 'D1', member_id: 3, license_nr: null, first_name: 'Cara', last_name: 'C' },
  { team_db_id: 80, team_id: 'vb_1393', team_name: 'D1', member_id: 3, license_nr: null, first_name: 'Cara', last_name: 'C' }, // dup row
  { team_db_id: 94, team_id: 'vb_1395', team_name: 'D2', member_id: 4, license_nr: '', first_name: 'Dora', last_name: 'D' },
  { team_db_id: 99, team_id: 'bb_7', team_name: 'Herren 2 H3', member_id: 5, license_nr: '500', first_name: 'Ed', last_name: 'E' },
]

test('buildWanted groups by team, trims licences, drops teams without a VM id, dedups', () => {
  const wanted = buildWanted(ROWS)
  assert.deepEqual(wanted.map((w) => w.teamName), ['D1', 'D2'])
  const d1 = wanted[0]
  assert.equal(d1.staticId, 1393)
  assert.equal(d1.teamDbId, 80)
  assert.equal(d1.players.length, 3, 'duplicate member row collapsed')
  assert.deepEqual(d1.players.map((p) => p.licenseNr), ['100', '200', null])
  assert.equal(d1.players[0].name, 'Anna A')
  assert.equal(wanted[1].players[0].licenseNr, null, 'empty string is no licence')
})

const D1 = {
  teamDbId: 80, staticId: 1393, teamName: 'D1',
  players: [
    { memberId: 1, licenseNr: '100', name: 'Already On' },
    { memberId: 2, licenseNr: '200', name: 'To Assign' },
    { memberId: 3, licenseNr: '300', name: 'Not Activated' },
    { memberId: 4, licenseNr: null, name: 'No Licence' },
  ],
}
const VM_MEMBERS = [
  { licenseNr: '100', name: 'Already On', functionType: 'player' },
  { licenseNr: '900', name: 'Extra Player', functionType: 'player' },
  { licenseNr: '200', name: 'To Assign', functionType: 'coach' },   // a coach row is NOT a player row
  { licenseNr: '800', name: 'Some Coach', functionType: 'coach' },
]
const ASSIGNABLE = new Map([
  ['200', { indoorPlayerId: 'ip-200', licenseNr: '200', name: 'To Assign' }],
  ['999', { indoorPlayerId: 'ip-999', licenseNr: '999', name: 'Unrelated Activated' }],
])

test('planTeam: splits wanted players by what VM holds and offers', () => {
  const plan = planTeam(D1, VM_MEMBERS, ASSIGNABLE)
  assert.deepEqual(plan.alreadyOnTeam.map((p) => p.licenseNr), ['100'])
  assert.deepEqual(plan.toAssign.map((p) => [p.licenseNr, p.indoorPlayerId]), [['200', 'ip-200']],
    'a coach row on VM does not count as "already a player" — VM still offers them')
  assert.deepEqual(plan.licencePending.map((p) => p.licenseNr), ['300'], 'not offered by VM → pending')
  assert.deepEqual(plan.noLicenceNr.map((p) => p.name), ['No Licence'])
  assert.equal(plan.vmPlayerCount, 2, 'players only, staff excluded')
})

test('planTeam: extraOnVm names VM players we do not roster, and never proposes removing them', () => {
  const plan = planTeam(D1, VM_MEMBERS, ASSIGNABLE)
  assert.deepEqual(plan.extraOnVm, [{ licenseNr: '900', name: 'Extra Player' }])
  assert.ok(!('toRemove' in plan))
})

test('planTeam: an activated player who is not on our roster is never assigned', () => {
  const plan = planTeam(D1, VM_MEMBERS, ASSIGNABLE)
  assert.ok(!plan.toAssign.some((p) => p.licenseNr === '999'))
})

test('planTeam: empty VM team assigns everyone VM offers', () => {
  const plan = planTeam(D1, [], ASSIGNABLE)
  assert.deepEqual(plan.toAssign.map((p) => p.licenseNr), ['200'])
  assert.deepEqual(plan.licencePending.map((p) => p.licenseNr), ['100', '300'], 'on nobody\'s list and not offered → pending')
  assert.equal(plan.extraOnVm.length, 0)
})
