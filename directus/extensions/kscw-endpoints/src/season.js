/**
 * THE season module (kscw-endpoints). Single source of truth for "which season
 * is it" inside this extension.
 *
 * ⚠ This file is a deliberate copy of `src/utils/season.ts` — the extensions are
 * rsynced from directus/extensions/ and cannot import from src/, so the logic
 * exists once per deploy unit:
 *
 *   src/utils/season.ts
 *   directus/extensions/kscw-endpoints/src/season.js   ← you are here
 *   public.kscw_current_season_start()                 (migration 268)
 *
 * kscw-hooks does NOT keep its own copy — it imports this file across the
 * extension boundary (both extensions are rsynced together), the same way it
 * already imports error-log.js, email-template.js, push-i18n.js and four others.
 *
 * They are kept in agreement mechanically, not by discipline:
 * `src/utils/__tests__/season-parity.test.ts` imports both JS modules and asserts
 * they agree on every day of a four-year span. Change one → that test fails
 * until you change the other. Read the full rationale (and the two bugs
 * that motivated it) in the header of `src/utils/season.ts`.
 *
 * The short version: a season is named for the year it starts in. The club rolls
 * over on **Jun 1**, the fixture calendar starts **Sep 1**. That gap is the sharp
 * edge — `seasonStartDate()` is in the FUTURE from Jun 1 to Aug 31, so anything
 * that needs a window START must use `seasonRolloverDate()` or it silently drops
 * the whole summer. All boundaries are Europe/Zurich (the VPS runs UTC; several
 * of the copies this replaced used the UTC month and flipped two hours early).
 */

/** Today's Zurich calendar date as [year, month(1-12), day]. */
function zurichParts(now) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).split('-').map(Number)
  return [y, m, d]
}

/**
 * The year the current season started in — the one primitive everything else
 * derives from. Jun–Dec → this year; Jan–May → last year.
 */
export function seasonStartYear(now = new Date()) {
  const [y, m] = zurichParts(now)
  return m < 6 ? y - 1 : y
}

/** Current season, Wiedisync short form: "2026/27". */
export function currentSeasonShort(now = new Date()) {
  const y = seasonStartYear(now)
  return `${y}/${String(y + 1).slice(2)}`
}

/** Current season, SVRZ long form: "2026/2027". */
export function currentSeasonLong(now = new Date()) {
  const y = seasonStartYear(now)
  return `${y}/${y + 1}`
}

/**
 * Sep 1 of the current season — when the fixture calendar starts.
 * ⚠ In the future from Jun 1 to Aug 31. For a window START use
 * `seasonRolloverDate()`; for filtering fixtures this is the right anchor.
 */
export function seasonStartDate(now = new Date()) {
  return `${seasonStartYear(now)}-09-01`
}

/**
 * Jun 1 of the current season — the rollover, and the only anchor that is
 * always in the past. Use this for counter/window starts. Mirrors the 'season'
 * branch of kscw_fine_window_start (migration 268).
 */
export function seasonRolloverDate(now = new Date()) {
  return `${seasonStartYear(now)}-06-01`
}

/** May 31 of the current season — the last fixture month. */
export function seasonEndDate(now = new Date()) {
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
export function seasonForYmd(ymd) {
  const [y, m] = String(ymd).split('-').map(Number)
  const startYear = m < 6 ? y - 1 : y
  return `${startYear}/${String(startYear + 1).slice(2)}`
}
