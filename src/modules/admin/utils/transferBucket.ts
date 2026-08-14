// src/modules/admin/utils/transferBucket.ts
//
// Which international-transfer cohort a member belongs to. Lifted out of
// TransfersPage so the one rule that can make the worklist SHORTER is testable
// on its own: everything else on that page reports, and only this decides who
// is on the list at all.

import { NO_FEDERATION, parseCountryCodes } from '../../../utils/countries'

/** The slice of a member this decision reads — nothing else is relevant to it. */
export interface TransferBucketInput {
  federation_of_origin?: string | null
  kscw_membership_active?: boolean
  nationalitaet_codes?: string | null
  transfer_status?: 'pending' | 'done' | 'not_needed' | null
}

/**
 * Which bucket a member falls into. Derived, never stored.
 *
 * `federation_of_origin` is the association that held the member's licence **at
 * age 14** (Swiss Volley / FIVB Sports Regulations) — NOT simply the first
 * federation they ever played under. Someone licensed in Italy at 8 and by Swiss
 * Volley at 14 has federation of origin CH.
 *
 *  - `needs`  — licensed at 14 by a federation that is neither 'NONE' nor 'CH'.
 *               This maps 1:1 onto Swiss Volley's transfer trigger: an ITC is
 *               required for anyone licensed abroad at 14, "egal ob der Spieler
 *               seit längerem in der Schweiz wohnt, nur Amateur ist, keinen
 *               Vertrag hat" — including RL/JL, where the fee is CHF 0 but the
 *               transfer is still mandatory. The actionable cohort.
 *  - `swiss`  — 'CH': Swiss Volley held the age-14 licence, so no INTERNATIONAL
 *               transfer applies. Split out from `settled` because Swiss Volley
 *               is a federation in VIS with its own player index exactly like
 *               the others (`vis_federations` vis_no 189 / SUI) — so these
 *               members can be grouped, contacted and VIS-checked under it
 *               rather than disappearing into a bare tally. No transfer control:
 *               there is no transfer to have a status about.
 *  - `settled`— 'NONE' — held no national-federation licence at 14, because a
 *               purely recreational body such as CSI/UISP/PGS is not an
 *               FIVB/FIBA member. Counted only; there is no federation to group
 *               them under and no index to look them up in.
 *  - `clarify`— never answered, but holds a non-Swiss nationality and is an
 *               active KSCW member. A question to ask, not a pending transfer.
 *               Nationality is only a heuristic for WHOM to ask — it is not the
 *               trigger; the age-14 licence is.
 *  - `ignore` — nothing to act on (Swiss nationality, or inactive).
 *
 * Two things outrank the federation column, and BOTH only ever take work AWAY
 * from the actionable cohorts — neither can invent one:
 *
 *  - a stored `not_needed`, which is a person's explicit ruling;
 *  - `vmSaysSwiss`, the derivation: Swiss Volley — who is the authority that
 *    would demand the ITC — already licences this member as Swiss, so there is
 *    nothing for us to chase whether that is because no transfer was ever
 *    required or because one already completed. Derived at DISPLAY time and
 *    never written, so correcting either register corrects the conclusion by
 *    itself, and the `fooConflicts` banner still reports the disagreement.
 *
 * A stored 'pending'/'done' deliberately does NOT move anybody: it is recorded
 * in place, in whichever cohort the member already belongs to, so that marking
 * a Swiss-origin member as being chased never duplicates a federation group.
 */
export type Bucket = 'needs' | 'swiss' | 'settled' | 'clarify' | 'ignore'

export function bucketOf(m: TransferBucketInput, vmSaysSwiss = false): Bucket {
  const base = federationBucketOf(m)
  // Applied to the two WORKLIST cohorts only, so an override can subtract work
  // and can never add any: it cannot revive an inactive member out of `ignore`,
  // and it cannot empty the Swiss reference list, which was never work.
  if (base !== 'needs' && base !== 'clarify') return base
  if (m.transfer_status === 'not_needed' || vmSaysSwiss) return 'settled'
  return base
}

/** The federation column's own verdict, before any override. */
export function federationBucketOf(m: TransferBucketInput): Bucket {
  const fed = String(m.federation_of_origin ?? '').trim().toUpperCase()
  if (fed === 'CH') return 'swiss'
  if (fed) return fed === NO_FEDERATION ? 'settled' : 'needs'
  // No answer yet. Only worth chasing for active members holding a nationality
  // we know is not Swiss — a Swiss passport makes a Swiss age-14 licence by far
  // the likeliest answer, so those are not worth a chase list.
  if (!m.kscw_membership_active) return 'ignore'
  const codes = parseCountryCodes(m.nationalitaet_codes)
  if (codes.length === 0 || codes.includes('CH')) return 'ignore'
  return 'clarify'
}
