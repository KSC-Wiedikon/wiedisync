/**
 * Convert long-form SVRZ season names (e.g. "2025/2026") to Wiedisync's
 * short convention ("2025/26"). Returns the input unchanged for anything
 * that doesn't match the YYYY/YYYY pattern.
 */
export function formatSeasonShort(name: string | null | undefined): string {
  if (!name) return ''
  const m = name.match(/^(\d{4})\/(\d{4})$/)
  return m ? `${m[1]}/${m[2].slice(-2)}` : name
}

/**
 * Current SVRZ season in long form (e.g. "2025/2026"). Re-exported from
 * `src/utils/season.ts`, which owns the Jun 1 cutover — the SVRZ cron
 * (kscw-hooks) and the svrz-sync endpoint (kscw-endpoints) used to duplicate
 * this inline; they now import their own extension's season module, and
 * `season-parity.test.ts` asserts all three stay in agreement.
 */
export { currentSeasonLong } from '../../../utils/season'

/**
 * Previous season in Wiedisync short form, given a short-form season.
 * "2026/27" → "2025/26". Returns '' if the input doesn't match YYYY/YY.
 */
export function previousSeasonShort(season: string | null | undefined): string {
  if (!season) return ''
  const m = season.match(/^(\d{4})\/\d{2}$/)
  if (!m) return ''
  const startYear = parseInt(m[1], 10) - 1
  return `${startYear}/${String(startYear + 1).slice(-2)}`
}
