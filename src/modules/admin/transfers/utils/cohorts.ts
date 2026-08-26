/**
 * The cohort derivations for `/admin/transfers`: who is on the worklist, who was
 * taken off it, who is deliberately not shown at all, and where the two
 * registers disagree.
 *
 * Pure and React-free, so the handful of rules that can make the worklist
 * SHORTER are testable on their own.
 *
 * ⚠ `bucketOf` / `federationBucketOf` are NOT part of this file — they stay in
 * `../../utils/transferBucket` with their own test, and they remain the ONLY
 * thing that decides who is on the list at all. Everything here reports over
 * that decision; no view may re-derive a cohort for itself.
 */

import { bucketOf, federationBucketOf } from '../../utils/transferBucket'
import { SPORT } from '../constants'
import type { Team } from '../../../../types'
import type {
  FooConflict, FooConflictKind, HiddenCounts, TransferCohorts, TransferGroup,
  TransferMember, VisPresenceCounts,
} from '../types'

/** Group rows by a key, ordered by member count desc, then label. */
export function groupRows(
  rows: readonly TransferMember[],
  keyOf: (m: TransferMember) => string,
  labelOf: (key: string) => string,
): TransferGroup[] {
  const byKey = new Map<string, TransferMember[]>()
  for (const m of rows) {
    const key = keyOf(m)
    const arr = byKey.get(key)
    if (arr) arr.push(m)
    else byKey.set(key, [m])
  }
  return [...byKey.entries()]
    .map(([key, keyRows]) => ({ key, label: labelOf(key), rows: keyRows }))
    .sort((a, b) => (b.rows.length - a.rows.length) || a.label.localeCompare(b.label))
}

/**
 * The volleyball cohorts. `u20` is a COUNT, not a list: those members are
 * exempt by the team they play in (`NO_TRANSFER_VB_TEAM_NAMES`), so there is
 * no per-member state to keep and nothing to work — but they are reported in
 * the header, because an exemption that is invisible is indistinguishable
 * from a bug.
 *
 * `notNeeded` is a LIST for the same reason turned up a level. These are
 * members the federation column puts squarely on the worklist and an override
 * takes off it, so they are the only cohort whose membership is a judgement
 * rather than a fact — the one place where "the list got shorter" could hide a
 * mistake. They get a table, a count and their status control, so the decision
 * is visible and reversible. Members the federation column never put on the
 * worklist stay in the bare `settled` tally: nothing was overridden for them.
 *
 * ⚠ `notNeeded` is therefore NOT out of scope for the eligibility alarm: the
 * "marked done, licence not validated" check runs over `needs.concat(notNeeded)`,
 * because a member cleared off the worklist by `vmSaysSwiss` who still carries
 * `transfer_status = 'done'` and an unvalidated licence is exactly the person
 * nobody is looking at, and fielding them is sanctionable (FIVB Disciplinary
 * Regulations Art. 11.4). The "you can probably tick this off" nudge stays
 * scoped to `needs` — it is a hint about work in progress, not a safety alarm.
 */
export function buildCohorts(
  members: readonly TransferMember[],
  deps: {
    playsVolleyball: (id: string) => boolean
    vmSaysSwiss: (m: TransferMember) => boolean
    u20OnlyMembers: ReadonlySet<string>
  },
): TransferCohorts {
  const acc: TransferCohorts = {
    needs: [],
    clarify: [],
    swiss: [],
    notNeeded: [],
    settled: 0,
    u20: 0,
  }
  for (const m of members) {
    const bucket = bucketOf(m, deps.vmSaysSwiss(m))
    if (bucket === 'ignore') continue
    const id = String(m.id)
    if (!deps.playsVolleyball(id)) continue
    // The exemption only removes WORK. A U20 player with a Swiss answer keeps
    // their place in the Swiss reference list below — nothing about them
    // changed, they were never work.
    if ((bucket === 'needs' || bucket === 'clarify') && deps.u20OnlyMembers.has(id)) {
      acc.u20 += 1
      continue
    }
    if (bucket === 'needs') acc.needs.push(m)
    else if (bucket === 'clarify') acc.clarify.push(m)
    else if (bucket === 'swiss') acc.swiss.push(m)
    else if (bucket === 'settled' && federationBucketOf(m) !== 'settled') acc.notNeeded.push(m)
    else acc.settled += 1
  }
  return acc
}

/**
 * Members who WOULD be on a worklist but are not shown, reported on the page so
 * a filter never silently swallows a real transfer.
 *
 * The three reasons are counted SEPARATELY because they mean different
 * things: "on no team" is a data gap to fix (give them a team and they
 * reappear), "guest only" is the correct answer (no licence, so no transfer),
 * and "basketball" is a whole sport this page does not cover — see `SPORT`.
 *
 * Only the two WORKLIST cohorts count. A settled member never had a row to
 * lose, and the Swiss cohort is a reference list rather than work — counting
 * either would report hundreds of members as "hidden" from a list nobody is
 * expected to act on.
 */
export function countHidden(
  members: readonly TransferMember[],
  deps: {
    playsVolleyball: (id: string) => boolean
    vmSaysSwiss: (m: TransferMember) => boolean
    sportsByMember: ReadonlyMap<string, ReadonlySet<Team['sport']>>
    guestSportsByMember: ReadonlyMap<string, ReadonlySet<Team['sport']>>
  },
): HiddenCounts {
  let noTeam = 0
  let guestOnly = 0
  let basketball = 0
  for (const m of members) {
    const bucket = bucketOf(m, deps.vmSaysSwiss(m))
    if (bucket !== 'needs' && bucket !== 'clarify') continue
    const id = String(m.id)
    // Routed through `playsVolleyball`, not through `sportsByMember` directly,
    // so the "hidden" tally can never disagree with what the page shows: a
    // member admitted by their Volleymanager licence is on screen and must not
    // also be reported as missing from it.
    if (deps.playsVolleyball(id)) continue
    // Guest first: a volleyball guest is dropped for the licence reason, not
    // for whatever else they may also play.
    if (deps.guestSportsByMember.get(id)?.has(SPORT)) guestOnly += 1
    else if (deps.sportsByMember.get(id)?.size || deps.guestSportsByMember.get(id)?.size) basketball += 1
    else noTeam += 1
  }
  return { noTeam, guestOnly, basketball }
}

/**
 * Where OUR federation of origin and VOLLEYMANAGER'S disagree.
 *
 * This is the one comparison that can move a member between "owes an ITC" and
 * "owes nothing", so it is computed across every cohort on the page — not just
 * the worklist. The `swiss` cohort is where the DANGEROUS direction hides: we
 * record CH, Swiss Volley records a foreign federation, and nobody is chasing
 * a transfer that may be required.
 *
 * ⚠ Never auto-applied. `federation_of_origin` is the member's own answer and
 * is member-editable (migration 234); VM's value is the register's answer.
 * Which one is wrong is a human question with two different remedies — correct
 * our record, or ask Swiss Volley to correct theirs — so this reports and lets
 * an admin decide. Silently adopting VM would also erase the evidence that the
 * register needs fixing, which is the whole reason to look.
 *
 * Prod 2026-08-13: 15 conflicts / 223 licensed members — 11 vmSaysSwiss,
 * 3 vmSaysForeign, 1 both-foreign.
 */
export function findFooConflicts(
  members: readonly TransferMember[],
  deps: {
    playsVolleyball: (id: string) => boolean
    vmPlaysAsByMember: ReadonlyMap<string, string>
    isoByFivbCode: ReadonlyMap<string, string>
  },
): FooConflict[] {
  const out: FooConflict[] = []
  for (const m of members) {
    const id = String(m.id)
    if (!deps.playsVolleyball(id) || bucketOf(m) === 'ignore') continue
    const vmCode = deps.vmPlaysAsByMember.get(id)
    if (!vmCode) continue
    const vmIso = deps.isoByFivbCode.get(vmCode)
    if (!vmIso) continue
    const ourIso = String(m.federation_of_origin ?? '').trim().toUpperCase()
    if (!ourIso || ourIso === vmIso) continue
    const kind: FooConflictKind = vmIso === 'CH'
      ? 'vmSaysSwiss'
      : ourIso === 'CH' ? 'vmSaysForeign' : 'bothForeign'
    out.push({ m, ourIso, vmIso, vmCode, kind })
  }
  // Dangerous direction first: a possibly-missing transfer outranks a
  // possibly-unnecessary one.
  const rank: Record<FooConflictKind, number> = { vmSaysForeign: 0, bothForeign: 1, vmSaysSwiss: 2 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]
    || String(a.m.last_name).localeCompare(String(b.m.last_name), 'de-CH'))
}

/**
 * The three-way VIS presence split over a set of rows.
 *
 * The page counts it across the ACTIONABLE cohort only — the settled and
 * to-clarify members are never checked, so counting them would just inflate
 * "not checked" with rows nobody is expected to act on. The scope is the
 * caller's to choose here (the group headers count their own rows), which is
 * exactly why every figure it produces has to be rendered next to a stated
 * scope.
 */
export function countVisPresence(rows: readonly TransferMember[]): VisPresenceCounts {
  let inVis = 0
  let notFound = 0
  let unchecked = 0
  for (const m of rows) {
    if (m.in_vis === true) inVis += 1
    else if (m.in_vis === false) notFound += 1
    else unchecked += 1
  }
  return { inVis, notFound, unchecked }
}

/**
 * Newest `in_vis_checked_at` anywhere in the loaded set — i.e. when the VIS
 * columns were last established. Across ALL members, not just the actionable
 * cohort: one run writes every row it evaluated, so the newest timestamp is
 * the run, and reading it off a filtered subset would understate it on a tab
 * where nothing is actionable. Directus returns ISO-8601 UTC, which sorts
 * lexicographically, so a string compare is the right one here.
 */
export function newestVisCheck(members: readonly TransferMember[]): string | null {
  let newest: string | null = null
  for (const m of members) {
    const at = m.in_vis_checked_at
    if (at && (!newest || at > newest)) newest = at
  }
  return newest
}

/**
 * Where a row's status comes from when nothing is stored — the DERIVED answer,
 * said out loud.
 *
 * Saying it is the point. An empty control reads as "not done yet" whichever
 * way the derivation actually went, so a member Swiss Volley already licences
 * as Swiss looked exactly like one nobody had got to. The pill names the
 * source, because the two derivations are corrected in completely different
 * places: ours in this app, Swiss Volley's by asking them.
 */
export function derivedStatusSource(
  m: TransferMember,
  vmSaysSwiss: boolean,
): 'volleymanager' | 'ours' | null {
  // Only the two federation answers that MEAN "nothing to do" derive anything.
  // A member who has never answered derives nothing — that is what the whole
  // `clarify` cohort is, and telling them "no transfer needed" would answer a
  // question nobody has asked yet.
  const ourVerdict = federationBucketOf(m)
  return m.transfer_status
    ? null
    : vmSaysSwiss
      ? 'volleymanager'
      : (ourVerdict === 'swiss' || ourVerdict === 'settled') ? 'ours' : null
}
