// --- Intl-Zurich helpers (proper UTC convention) ---

import i18n from '../i18n'
import { currentSeasonShort } from './season'

const ZURICH = 'Europe/Zurich';

/** Map the current i18next language to a BCP-47 tag Intl understands.
 *  `gsw` (Swiss German) has no widely-supported Intl data — fall back to `de-CH`. */
export function currentLocale(): string {
  const lng = (i18n.language || 'de').toLowerCase()
  if (lng.startsWith('gsw') || lng === 'de') return 'de-CH'
  if (lng.startsWith('de')) return lng
  if (lng.startsWith('en')) return 'en-GB' // keep dd/mm order + 24h closer to Swiss expectations
  return lng
}

function formatZurichParts(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZURICH,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(d);
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

/**
 * Parse a flexible string into a Date. Handles:
 *   • ISO datetime ("YYYY-MM-DDTHH:MM:SS[Z|±hh:mm]") — passed through.
 *   • "YYYY-MM-DD HH:MM:SS" (Postgres timestamp text) — treated as UTC.
 *   • Bare "YYYY-MM-DD" — anchored to midnight UTC.
 *
 * Bare-date handling matters: appending just 'Z' to "2026-05-07" yields
 * "2026-05-07Z", which V8 silently parses but Safari/JavaScriptCore rejects
 * as Invalid Date. That made every bare `date` field render as "" on iOS
 * Safari (e.g. trainings list missing weekday/date next to the team chip).
 */
function parseFlexible(input: string): Date {
  if (input.includes('T')) return new Date(input);
  if (input.includes(' ')) return new Date(input.replace(' ', 'T') + 'Z');
  return new Date(input + 'T00:00:00Z');
}

/** Format HH:mm in Europe/Zurich, accepts ISO UTC, "YYYY-MM-DD HH:MM:SS" (treated as UTC), or bare "HH:MM".
 *  Locale is hardcoded to `de-CH` so the output is always 24-hour `HH:mm`
 *  regardless of the user's browser language — the en-US default would
 *  produce `2:32 PM` style output on English-speaking clients. */
export function formatTimeZurich(input: string | Date | null | undefined, locale: string = 'de-CH'): string {
  if (!input) return '';
  if (typeof input === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(input)) return input.slice(0, 5);
  const d = typeof input === 'string'
    ? parseFlexible(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: ZURICH, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

/** Format dd.mm.yyyy in Europe/Zurich. */
export function formatDateZurich(input: string | Date | null | undefined, locale: string = 'de-CH'): string {
  if (!input) return '';
  const d = typeof input === 'string'
    ? parseFlexible(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: ZURICH, day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

/** Format dd.mm.yyyy (compact) in Europe/Zurich.
 *  Locale is hardcoded to `de-CH` so the output is always Swiss dot format
 *  (`10.05.2026`) regardless of the user's browser language — en-US default
 *  yields `05/10/26` (mm/dd/yy), which is wrong for our audience and reads
 *  as the wrong date for half the year. App-wide convention is dd.mm.yyyy
 *  (4-digit year) per `CLAUDE.md → Time & Date Formatting`. */
export function formatDateCompactZurich(input: string | Date | null | undefined, locale: string = 'de-CH'): string {
  if (!input) return '';
  const d = typeof input === 'string'
    ? parseFlexible(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    timeZone: ZURICH, day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

/* REMOVED 2026-08-10 — `formatDateShortZurich` returned MM/DD ("06/15").
 *
 * It had no caller left in the app and existed only to preserve a legacy en-US
 * shape, which made it a loaded gun: the next dense-UI date would reasonably
 * have reached for the helper literally named "short date" and shipped the one
 * format this codebase forbids. `dd.mm` is `formatDayMonthZurich` below; the
 * full form is `formatDateZurich`. Day-first, dot-separated, always —
 * CLAUDE.md → Date & time format. */

/** Format dd.mm in Europe/Zurich — year-less short date for dense UI (ticker pills). */
export function formatDayMonthZurich(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string'
    ? parseFlexible(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  const p = formatZurichParts(d);
  return `${p.day}.${p.month}`;
}

/** Format short weekday ("Mo", "Di", ...) in Europe/Zurich.
 *  Weekday names follow the active UI language by default (currentLocale). */
export function formatWeekdayZurich(input: string | Date | null | undefined, locale: string = currentLocale()): string {
  if (!input) return '';
  const d = typeof input === 'string'
    ? parseFlexible(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { timeZone: ZURICH, weekday: 'short' }).format(d);
}

/** "dd.mm.yy HH:mm" compact datetime in Europe/Zurich. */
export function formatDateTimeCompactZurich(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string'
    ? parseFlexible(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDateCompactZurich(d)} ${formatTimeZurich(d)}`;
}

/** Relative time ("vor 2 Std.", "in 3 Tagen"). Uses actual UTC-stored instant. */
export function formatRelativeTimeZurich(input: string | Date | null | undefined, locale: string = 'de'): string {
  if (!input) return '';
  const d = typeof input === 'string'
    ? parseFlexible(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = d.getTime() - Date.now();
  const absSec = Math.abs(diffMs) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absSec < 60)      return rtf.format(Math.round(diffMs / 1000), 'second');
  if (absSec < 3600)    return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (absSec < 86400)   return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  if (absSec < 2592000) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  if (absSec < 31_536_000) return rtf.format(Math.round(diffMs / 2_592_000_000), 'month');
  return rtf.format(Math.round(diffMs / 31_536_000_000), 'year');
}

/** Round-trip: datetime-local input value ("2026-04-19T12:30") interpreted as Europe/Zurich -> UTC ISO. */
export function toUtcIsoFromDatetimeLocal(localStr: string): string {
  const [date, time] = localStr.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const guessUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);

  const offset1 = getZurichOffsetMs(guessUtcMs);
  const corrected1 = guessUtcMs - offset1;
  const offset2 = getZurichOffsetMs(corrected1);
  // Non-DST-transition times: offset1 === offset2, single pass is correct.
  // DST transition: offset2 reflects the actual zone at the corrected instant; use it.
  const offsetMs = offset1 === offset2 ? offset1 : offset2;
  return new Date(guessUtcMs - offsetMs).toISOString();
}

function getZurichOffsetMs(instantMs: number): number {
  const p = formatZurichParts(new Date(instantMs));
  const shownMs = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return shownMs - instantMs;
}

/**
 * True when "now" is within ±windowMs of a game's Zurich kickoff (date
 * 'YYYY-MM-DD' + time 'HH:MM[:SS]'). Shared by the scorer page and the game
 * detail modal to gate coach/TR visibility of scorer contact to around the game.
 */
export const SCORER_CONTACT_WINDOW_MS = 60 * 60 * 1000;
/**
 * Kickoff as epoch ms. `games.date` and `games.time` are separate DST-naive columns holding
 * a Zurich wall-clock, so re-deriving this by hand is how you get a window that is an hour
 * out for half the year — go through toUtcIsoFromDatetimeLocal, like the contact window below.
 */
export function gameKickoffMs(
  date: string | null | undefined,
  time: string | null | undefined,
): number | null {
  if (!date || !time) return null;
  try {
    const ms = new Date(
      toUtcIsoFromDatetimeLocal(`${String(date).slice(0, 10)}T${String(time).slice(0, 5)}`),
    ).getTime();
    return Number.isNaN(ms) ? null : ms;
  } catch { return null; }
}

/** Identity documents are DISPLAYED only in this window before kickoff. */
export const ID_SHOW_BEFORE_MS = 45 * 60 * 1000;

/**
 * Where we are relative to the identity-document display window.
 *
 * Lives here rather than in the component so `Date.now()` is not called during render
 * (React treats it as impure) — the same reason isWithinDutyLateWindow below is a helper.
 */
export function idWindowState(
  kickoffMs: number | null,
): 'unknown' | 'before' | 'open' | 'closed' {
  if (kickoffMs == null) return 'unknown';
  const now = Date.now();
  if (now < kickoffMs - ID_SHOW_BEFORE_MS) return 'before';
  if (now > kickoffMs) return 'closed';
  return 'open';
}

export function isWithinGameContactWindow(
  date: string | null | undefined,
  time: string | null | undefined,
  windowMs: number = SCORER_CONTACT_WINDOW_MS,
): boolean {
  if (!date || !time) return false;
  try {
    const startMs = new Date(toUtcIsoFromDatetimeLocal(`${String(date).slice(0, 10)}T${String(time).slice(0, 5)}`)).getTime();
    if (Number.isNaN(startMs)) return false;
    const now = Date.now();
    return now >= startMs - windowMs && now <= startMs + windowMs;
  } catch { return false; }
}

/**
 * Minutes before kickoff each duty role must be in the hall. Single source of
 * truth for both the displayed arrival times (/scorer) and the "duty is late"
 * alarm window (game detail modal). MUST match ROLE_DEFS[*].arrival in the
 * kscw-endpoints duty-late endpoint.
 */
export const DUTY_ARRIVAL_MIN: Record<string, number> = {
  scorer: 30,
  scoreboard: 15,
  scorer_scoreboard: 30,
  referee: 30,
  bb_scorer: 15,
  bb_timekeeper: 15,
  bb_24s_official: 15,
};

/** The alarm + contact reveal stay available for this long AFTER kickoff. */
export const DUTY_LATE_GRACE_MS = 30 * 60 * 1000;

/**
 * True when the duty "emergency" (report-late) button should be shown for a
 * role: from ONE MINUTE PAST the arrival deadline until kickoff + grace, i.e.
 * [kickoff − (arrival − 1), kickoff + grace]. The button only surfaces once the
 * official is actually late — so scorer / referee / scorer+scoreboard (30'
 * arrival) show it at 29', and täfeler + BB officials (15') at 14'.
 *
 * The backend duty-late window opens at the arrival deadline itself (one minute
 * earlier) and always accepts a click made while the button is visible, so the
 * two stay compatible without matching to the minute.
 */
export function isWithinDutyLateWindow(
  date: string | null | undefined,
  time: string | null | undefined,
  role: string,
): boolean {
  if (!date || !time) return false;
  // Appear one minute past the arrival deadline (29' / 14'), never negative.
  const leadMs = Math.max(0, (DUTY_ARRIVAL_MIN[role] ?? 30) - 1) * 60 * 1000;
  try {
    const startMs = new Date(toUtcIsoFromDatetimeLocal(`${String(date).slice(0, 10)}T${String(time).slice(0, 5)}`)).getTime();
    if (Number.isNaN(startMs)) return false;
    const now = Date.now();
    return now >= startMs - leadMs && now <= startMs + DUTY_LATE_GRACE_MS;
  } catch { return false; }
}

/** Inverse: UTC ISO -> "YYYY-MM-DDTHH:MM" for datetime-local input, in Europe/Zurich. */
export function toDatetimeLocalFromUtcIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = formatZurichParts(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}


/** Compact dd.mm.yy (or the locale-equivalent short form). */
export function formatDateCompact(d: string, locale?: string): string {
  return formatDateCompactZurich(d, locale)
}

export function formatDate(d: string, locale?: string): string {
  return formatDateZurich(d, locale)
}

export function formatWeekday(d: string, locale?: string): string {
  return formatWeekdayZurich(d, locale ?? currentLocale())
}

export function formatTime(t: string, locale?: string): string {
  return formatTimeZurich(t, locale)
}

export function isDateInRange(date: string, start: string, end: string): boolean {
  const d = new Date(date).getTime()
  return d >= new Date(start).getTime() && d <= new Date(end).getTime()
}

/**
 * Current season, short form ("2026/27"). Thin alias kept for the ~20 modules
 * that already import it from here — the cutover itself lives in
 * `src/utils/season.ts`, which is the only place it is implemented.
 */
export function getCurrentSeason(): string {
  return currentSeasonShort()
}

export function getSeasonDateRange(season: string): { start: string; end: string } {
  const startYear = parseInt(season.split('/')[0])
  return {
    start: `${startYear}-09-01`,
    end: `${startYear + 1}-08-31`,
  }
}

/**
 * Expand a short season string (`YYYY/YY`) to its full display form
 * (`YYYY/YYYY`) — e.g. `2025/26` → `2025/2026`. Used by the rankings season
 * selector so the dropdown reads in full years. Anything not in the expected
 * short form is returned unchanged.
 */
export function formatSeasonLong(season: string): string {
  const m = /^(\d{4})\/(\d{2})$/.exec(season)
  if (!m) return season
  return `${m[1]}/${m[1].slice(0, 2)}${m[2]}`
}

export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Today's date as YYYY-MM-DD in local timezone (NOT UTC). */
export function todayLocal(): string {
  return toISODate(new Date())
}

/** Returns the Europe/Zurich calendar date as "YYYY-MM-DD" for the given instant.
 *  Critical for all-day events: Directus stores them as 22:00 UTC the previous day
 *  (= midnight Zurich), so `iso.split('T')[0]` returns the wrong day. */
export function toZurichDateString(input: string | Date | null | undefined): string {
  if (!input) return ''
  const d = typeof input === 'string' ? parseFlexible(input) : input
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZURICH, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}


// --- Hallenplan utilities ---

/** Returns the Monday 00:00:00 of the week containing `date` */
export function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Returns array of 7 Dates [Mon..Sun] for the week starting at `monday` */
export function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
}

/** Parses 'HH:mm' to minutes since midnight (e.g., '08:30' => 510) */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Converts minutes since midnight to 'HH:mm' */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Returns day_of_week 0=Mon..6=Sun from a JS Date */
export function getDayOfWeek(date: Date): number {
  return (date.getDay() + 6) % 7
}

/** Returns a new Date advanced by `days` */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** Format a datetime as dd.mm.yy HH:mm */
export function formatDateTimeCompact(datetime: string): string {
  return formatDateTimeCompactZurich(datetime)
}

/** Format a datetime as locale-aware relative time (e.g. "vor 2 Std.", "2 hr. ago"). */
export function formatRelativeTime(datetime: string, locale: string = 'de'): string {
  return formatRelativeTimeZurich(datetime, locale)
}

/** Returns ISO week number */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const yearStart = new Date(d.getFullYear(), 0, 4)
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 6) / 7)
}

const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Returns short day name for day_of_week 0=Mon..6=Sun */
export function getDayName(dayOfWeek: number): string {
  return DAY_NAMES_SHORT[dayOfWeek]
}

/** Parse a respond_by datetime into { date, time } in Europe/Zurich.
 * Accepts ISO UTC or the legacy "YYYY-MM-DD HH:MM:SS" space format.
 *
 * Zurich-midnight (h+m+s all zero) is the stored sentinel for "no time set" —
 * getDeadlineDate resolves it to the activity's start time, else 23:59. This
 * parser MUST resolve it the same way: it feeds the deadline shown in the UI and
 * the value seeded into the edit forms, and reporting a literal "00:00" told the
 * user the deadline was midnight while the code enforced kickoff. Pass the
 * activity's start time as `fallbackStartTime` wherever there is one. */
export function parseRespondByTime(
  respondBy: string | null | undefined,
  fallbackStartTime?: string
): { date: string; time: string } | null {
  if (!respondBy) return null;
  const d = parseFlexible(respondBy);
  if (Number.isNaN(d.getTime())) return null;
  const p = formatZurichParts(d);
  const unset = p.hour === '00' && p.minute === '00' && p.second === '00';
  const time = unset
    ? (fallbackStartTime && /^\d{2}:\d{2}$/.test(fallbackStartTime) ? fallbackStartTime : '23:59')
    : `${p.hour}:${p.minute}`;
  return { date: `${p.year}-${p.month}-${p.day}`, time };
}

/** Compute deadline Date from respond_by ISO string.
 * When stored h+m+s in Europe/Zurich are all zero (sentinel for "unset"),
 * fall back to activityStartTime (HH:MM) or 23:59 on the Zurich-local date. */
export function getDeadlineDate(respondBy: string, activityStartTime?: string): Date {
  const d = parseFlexible(respondBy);
  if (Number.isNaN(d.getTime())) return new Date(NaN);
  const p = formatZurichParts(d);
  if (p.hour === '00' && p.minute === '00' && p.second === '00') {
    const fallback = activityStartTime && /^\d{2}:\d{2}$/.test(activityStartTime) ? activityStartTime : '23:59';
    return new Date(toUtcIsoFromDatetimeLocal(`${p.year}-${p.month}-${p.day}T${fallback}`));
  }
  return d;
}

