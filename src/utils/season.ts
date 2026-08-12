/**
 * THE season module (frontend). Single source of truth for "which season is it".
 *
 * ─── Why this file exists ────────────────────────────────────────────────────
 * The Jun 1 cutover used to be reimplemented inline at ~14 sites across three
 * codebases, in four different flavours (local vs UTC month, 0- vs 1-indexed,
 * short vs long form). They drifted, silently:
 *
 *   • kscw_current_season_start() sat on a Sep 1 cutover for a year while every
 *     JS caller used Jun 1 — fixed by migration 268 (2026-07-29).
 *   • messaging-helpers.js shareTeam() sat on an Aug 1 cutover, so from Jun 1 to
 *     Jul 31 it read the PREVIOUS season's rosters and downgraded teammates'
 *     DMs to approval-gated requests — 82 members were affected when it was
 *     found (2026-07-29).
 *
 * Nothing here is complicated. The bugs came from the logic being *copied*, so
 * the rule is: never inline the cutover again, import it.
 *
 * ─── The siblings ────────────────────────────────────────────────────────────
 * The frontend and the Directus extensions are separate deploy units (the
 * extensions are rsynced from directus/extensions/ and cannot import from src/),
 * so this logic exists twice by necessity:
 *
 *   src/utils/season.ts                             ← you are here
 *   directus/extensions/kscw-endpoints/src/season.js  (kscw-hooks imports this
 *                                                      one across the extension
 *                                                      boundary, as it already
 *                                                      does for 7 other modules)
 *   public.kscw_current_season_start()              (migration 268)
 *
 * They are kept honest mechanically, not by discipline: `season-parity.test.ts`
 * imports both JS modules and asserts they agree on every day of a four-year
 * span. Change one → the test fails until you change the other.
 *
 * ─── The model ───────────────────────────────────────────────────────────────
 * A season is named for the year it starts in: "2026/27" is 2026→2027.
 *
 *   Jun 1 2026  rollover      the club flips to 2026/27; counters reset here
 *   Sep 1 2026  season start  the fixture calendar begins
 *   May 31 2027 season end    last fixture month
 *   Aug 31 2027               the label's outer bound (getSeasonDateRange)
 *
 * The Jun–Aug gap is the sharp edge: the season has rolled over but its fixture
 * calendar has not started, so `seasonStartDate()` is a date in the FUTURE for
 * a quarter of the year. Anything that needs a *window start* must use
 * `seasonRolloverDate()` instead — anchoring on Sep 1 silently drops everything
 * that happens over the summer (this is exactly what broke the fines counter).
 *
 * All boundaries are Europe/Zurich, matching the Postgres function. Deriving
 * from the runtime's local clock would move the cutover for a member abroad,
 * and from UTC would move it two hours (which several of the old copies did).
 */

/**
 * Today's Zurich calendar date as [year, month(1-12), day].
 * Exported so the two DELIBERATE non-Jun-1 cutovers (the J+S Sep-1 activity
 * year, `jsSeasonForDate`) can still derive their month from Zurich rather than
 * the device clock — the boundary differs, the timezone must not.
 */
export function zurichParts(now: Date): [number, number, number] {
  // en-CA gives ISO-ordered YYYY-MM-DD, which is all we need from Intl.
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).split('-').map(Number)
  return [y, m, d]
}

/**
 * The year the current season started in — the one primitive everything else
 * derives from. Jun–Dec → this year; Jan–May → last year.
 */
export function seasonStartYear(now: Date = new Date()): number {
  const [y, m] = zurichParts(now)
  return m < 6 ? y - 1 : y
}

/** Current season, Wiedisync short form: "2026/27". */
export function currentSeasonShort(now: Date = new Date()): string {
  const y = seasonStartYear(now)
  return `${y}/${String(y + 1).slice(2)}`
}

/** Current season, SVRZ long form: "2026/2027". */
export function currentSeasonLong(now: Date = new Date()): string {
  const y = seasonStartYear(now)
  return `${y}/${y + 1}`
}

/**
 * Sep 1 of the current season — when the fixture calendar starts.
 * ⚠ In the future from Jun 1 to Aug 31. For a window START use
 * `seasonRolloverDate()`; for filtering fixtures this is the right anchor.
 */
export function seasonStartDate(now: Date = new Date()): string {
  return `${seasonStartYear(now)}-09-01`
}

/**
 * Jun 1 of the current season — the rollover, and the only anchor that is
 * always in the past. Use this for counter/window starts (fines, and anything
 * else that must not lose the summer). Mirrors the 'season' branch of
 * kscw_fine_window_start (migration 268).
 */
export function seasonRolloverDate(now: Date = new Date()): string {
  return `${seasonStartYear(now)}-06-01`
}

/** May 31 of the current season — the last fixture month. */
export function seasonEndDate(now: Date = new Date()): string {
  return `${seasonStartYear(now) + 1}-05-31`
}

/**
 * The season string containing a given `YYYY-MM-DD` calendar date — the same
 * Jun-1 rule as `currentSeasonShort()`, but for an arbitrary day rather than
 * today. Lives here so callers that need "which season was this game in?" stop
 * reimplementing the cutover (scorer-roster.js had the fifth copy).
 * Date-string in, date-string out: no timezone conversion, because a YMD is
 * already a calendar date.
 */
export function seasonForYmd(ymd: string): string {
  const [y, m] = String(ymd).split('-').map(Number)
  const startYear = m < 6 ? y - 1 : y
  return `${startYear}/${String(startYear + 1).slice(2)}`
}
