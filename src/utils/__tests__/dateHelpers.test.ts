import { describe, it, expect } from 'vitest';
import {
  formatTimeZurich, formatDateZurich, formatDateCompactZurich,
  formatWeekdayZurich,
  formatDateTimeCompactZurich, formatRelativeTimeZurich,
  toUtcIsoFromDatetimeLocal, toDatetimeLocalFromUtcIso,
  parseRespondByTime, getDeadlineDate,
} from '../dateHelpers';

describe('formatTimeZurich', () => {
  it('renders UTC ISO in Zurich CEST (+2)', () => {
    expect(formatTimeZurich('2026-04-19T10:30:00.000Z')).toBe('12:30');
  });
  it('renders UTC ISO in Zurich CET (+1)', () => {
    expect(formatTimeZurich('2026-01-15T09:30:00.000Z')).toBe('10:30');
  });
  it('passes through bare HH:MM unchanged', () => {
    expect(formatTimeZurich('07:45')).toBe('07:45');
  });
  it('passes through bare HH:MM:SS truncated', () => {
    expect(formatTimeZurich('07:45:30')).toBe('07:45');
  });
  it('accepts Directus "YYYY-MM-DD HH:MM:SS" as UTC', () => {
    expect(formatTimeZurich('2026-04-19 10:30:00')).toBe('12:30');
  });
  it('returns empty string on null / invalid', () => {
    expect(formatTimeZurich(null)).toBe('');
    expect(formatTimeZurich(undefined)).toBe('');
    expect(formatTimeZurich('not a date')).toBe('');
  });
});

describe('formatDateZurich', () => {
  it('renders Zurich-local date across midnight UTC boundary', () => {
    // 2026-04-18T23:30 UTC = 2026-04-19 01:30 Zurich CEST
    expect(formatDateZurich('2026-04-18T23:30:00.000Z')).toBe('19.04.2026');
  });
  it('handles date-only input', () => {
    // The implementation parses "YYYY-MM-DD" by appending T00:00:00Z — CET/CEST may shift the Zurich date.
    // Pick a value that stays the same regardless of season:
    expect(formatDateZurich('2026-06-15T12:00:00.000Z')).toBe('15.06.2026');
  });
});

describe('formatDateCompactZurich', () => {
  it('renders dd.mm.yyyy', () => {
    expect(formatDateCompactZurich('2026-06-15T12:00:00.000Z')).toBe('15.06.2026');
  });
});

describe('formatWeekdayZurich', () => {
  it('renders short weekday in German', () => {
    // 2026-06-15 is a Monday
    const result = formatWeekdayZurich('2026-06-15T12:00:00.000Z');
    expect(result).toMatch(/^Mo/);
  });
});

describe('formatDateTimeCompactZurich', () => {
  it('renders dd.mm.yyyy HH:mm', () => {
    expect(formatDateTimeCompactZurich('2026-04-19T10:30:00.000Z')).toBe('19.04.2026 12:30');
  });
});

describe('toUtcIsoFromDatetimeLocal <-> toDatetimeLocalFromUtcIso', () => {
  it('round-trips CEST (+2)', () => {
    const utc = toUtcIsoFromDatetimeLocal('2026-04-19T12:30');
    expect(utc).toBe('2026-04-19T10:30:00.000Z');
    expect(toDatetimeLocalFromUtcIso(utc)).toBe('2026-04-19T12:30');
  });
  it('round-trips CET (+1)', () => {
    const utc = toUtcIsoFromDatetimeLocal('2026-01-15T10:30');
    expect(utc).toBe('2026-01-15T09:30:00.000Z');
    expect(toDatetimeLocalFromUtcIso(utc)).toBe('2026-01-15T10:30');
  });
  it('DST spring-forward gap: maps non-existent 02:30 to post-fold 01:30Z (matches browser Date normalization)', () => {
    expect(toUtcIsoFromDatetimeLocal('2026-03-29T02:30')).toBe('2026-03-29T01:30:00.000Z');
  });
  it('DST fall-back: maps ambiguous 02:30 to second occurrence 01:30Z (CET, after fall-back)', () => {
    expect(toUtcIsoFromDatetimeLocal('2026-10-25T02:30')).toBe('2026-10-25T01:30:00.000Z');
  });
});

describe('formatRelativeTimeZurich', () => {
  it('returns a relative string for past moments', () => {
    const d = new Date(Date.now() - 30_000).toISOString();
    const result = formatRelativeTimeZurich(d, 'de');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
  it('returns a relative string for future moments', () => {
    const d = new Date(Date.now() + 3_600_000).toISOString();
    const result = formatRelativeTimeZurich(d, 'de');
    expect(result).toBeTruthy();
  });
});

describe('parseRespondByTime', () => {
  it('returns Zurich-local date + time from UTC ISO (CEST)', () => {
    expect(parseRespondByTime('2026-04-19T10:30:00.000Z')).toEqual({ date: '2026-04-19', time: '12:30' });
  });
  it('returns Zurich-local date + time from UTC ISO (CET)', () => {
    expect(parseRespondByTime('2026-01-15T09:30:00.000Z')).toEqual({ date: '2026-01-15', time: '10:30' });
  });
  it('accepts legacy "YYYY-MM-DD HH:MM:SS" format, interpreted as UTC', () => {
    expect(parseRespondByTime('2026-04-19 10:30:00')).toEqual({ date: '2026-04-19', time: '12:30' });
  });
  it('returns null on null/invalid', () => {
    expect(parseRespondByTime(null)).toBeNull();
    expect(parseRespondByTime(undefined)).toBeNull();
    expect(parseRespondByTime('not-a-date')).toBeNull();
  });

  // Zurich-midnight is the "no time set" sentinel. It must resolve exactly like
  // getDeadlineDate does — reporting a literal 00:00 told the user the deadline
  // was midnight while the code enforced kickoff.
  it('resolves the Zurich-midnight sentinel to the activity start time', () => {
    // 2026-04-18T22:00Z == 2026-04-19 00:00 Zurich (CEST) → sentinel
    expect(parseRespondByTime('2026-04-18T22:00:00.000Z', '19:30'))
      .toEqual({ date: '2026-04-19', time: '19:30' });
  });
  it('resolves the sentinel to 23:59 when no start time is given', () => {
    expect(parseRespondByTime('2026-04-18T22:00:00.000Z'))
      .toEqual({ date: '2026-04-19', time: '23:59' });
  });
  it('ignores a malformed start time and falls back to 23:59', () => {
    expect(parseRespondByTime('2026-04-18T22:00:00.000Z', 'nonsense'))
      .toEqual({ date: '2026-04-19', time: '23:59' });
  });
  it('does NOT apply the fallback when a real time is set', () => {
    expect(parseRespondByTime('2026-04-19T10:30:00.000Z', '19:30'))
      .toEqual({ date: '2026-04-19', time: '12:30' });
  });
  it('agrees with getDeadlineDate on the sentinel', () => {
    const respondBy = '2026-04-18T22:00:00.000Z';
    const parsed = parseRespondByTime(respondBy, '19:30');
    const deadline = getDeadlineDate(respondBy, '19:30');
    expect(formatTimeZurich(deadline.toISOString())).toBe(parsed?.time);
  });
});

describe('getDeadlineDate', () => {
  it('passes through non-sentinel times unchanged', () => {
    // 10:30Z = 12:30 Zurich CEST, non-sentinel
    const d = getDeadlineDate('2026-04-19T10:30:00.000Z', '09:00');
    expect(formatTimeZurich(d.toISOString())).toBe('12:30');
  });
  it('falls back to activityStartTime when Zurich h:m:s are 00:00:00', () => {
    // 22:00Z on 2026-04-18 = 00:00 Zurich CEST on 2026-04-19 (sentinel)
    const d = getDeadlineDate('2026-04-18T22:00:00.000Z', '09:00');
    expect(formatTimeZurich(d.toISOString())).toBe('09:00');
  });
  it('falls back to 23:59 when no activityStartTime given and Zurich h:m:s are zero', () => {
    const d = getDeadlineDate('2026-04-18T22:00:00.000Z');
    expect(formatTimeZurich(d.toISOString())).toBe('23:59');
  });
});


