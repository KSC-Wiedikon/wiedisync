/**
 * Fee-category check applied when approval copies `beitragskategorie` onto the
 * member (audit 2026-09-28, F-32 — hooks part).
 *
 * On a value that fails, approval still goes through (a person is not refused
 * membership over a typo) but the category is NOT copied; the caller logs it so
 * the admin sets it by hand.
 *
 * The rule itself lives in kscw-endpoints/src/fee-category.js, because
 * POST /kscw/registration applies the same check at submit time. One copy, so the
 * two can never disagree about which categories are valid.
 */

export { approvedFeeCategory } from '../../kscw-endpoints/src/fee-category.js'
