import type { CalendarEntry } from '../../types/calendar'

/**
 * Shared calendar entry-style + palette.
 *
 * Single source of truth for the "colour-by-type" mapping that the calendar
 * grids (`MonthGrid`, `WeekGrid`, `MobileMonthView`, `MobileWeekGrid`), the
 * overflow modal (`CalendarPage`) and the source filter (`CalendarFilters`)
 * all share. Keep the palette here so the views never drift apart.
 */

/* ── Tailwind chip colours (light + dark) per colour-key ───── */

export const barColors: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  'game-home': { bg: 'bg-brand-200', text: 'text-brand-900', darkBg: 'dark:bg-brand-800', darkText: 'dark:text-brand-100' },
  'game-away': { bg: 'bg-amber-200', text: 'text-amber-900', darkBg: 'dark:bg-amber-800', darkText: 'dark:text-amber-100' },
  game:        { bg: 'bg-brand-200', text: 'text-brand-900', darkBg: 'dark:bg-brand-800', darkText: 'dark:text-brand-100' },
  training:    { bg: 'bg-green-200', text: 'text-green-900', darkBg: 'dark:bg-green-800', darkText: 'dark:text-green-100' },
  closure:     { bg: 'bg-red-200', text: 'text-red-900', darkBg: 'dark:bg-red-800', darkText: 'dark:text-red-100' },
  event:       { bg: 'bg-purple-200', text: 'text-purple-900', darkBg: 'dark:bg-purple-800', darkText: 'dark:text-purple-100' },
  hall:        { bg: 'bg-cyan-200', text: 'text-cyan-900', darkBg: 'dark:bg-cyan-800', darkText: 'dark:text-cyan-100' },
  absence:     { bg: 'bg-gray-900', text: 'text-white', darkBg: 'dark:bg-gray-100', darkText: 'dark:text-gray-900' },
  'scorer-duty': { bg: 'bg-indigo-200', text: 'text-indigo-900', darkBg: 'dark:bg-indigo-800', darkText: 'dark:text-indigo-100' },
  birthday:    { bg: 'bg-pink-200', text: 'text-pink-900', darkBg: 'dark:bg-pink-800', darkText: 'dark:text-pink-100' },
  blue:        { bg: 'bg-blue-200', text: 'text-blue-900', darkBg: 'dark:bg-blue-800', darkText: 'dark:text-blue-100' },
}

/* ── solid dot / icon colours per colour-key ───────────────── */

export const dotColors: Record<string, string> = {
  'game-home': 'bg-brand-500',
  'game-away': 'bg-amber-500',
  game: 'bg-brand-500',
  training: 'bg-green-500',
  closure: 'bg-red-500',
  event: 'bg-purple-500',
  hall: 'bg-cyan-500',
  absence: 'bg-gray-900 dark:bg-gray-100',
  'scorer-duty': 'bg-indigo-500',
  birthday: 'bg-pink-500',
  blue: 'bg-blue-500',
}

/* ── `text-*` icon colours (overflow modal) ────────────────── */

export const iconColors: Record<string, string> = {
  game: 'text-brand-500',
  'game-home': 'text-brand-500',
  'game-away': 'text-amber-500',
  training: 'text-green-500',
  closure: 'text-red-500',
  event: 'text-purple-500',
  hall: 'text-cyan-500',
  absence: 'text-gray-900 dark:text-gray-100',
  'scorer-duty': 'text-indigo-500',
  birthday: 'text-pink-500',
}

/* ── filter-chip palette (hex) for the source multi-select ──── */

export const sourceColors: Record<string, { bg: string; text: string; border: string }> = {
  'game-home': { bg: '#4A55A2', text: '#ffffff', border: '#3b4590' },
  'game-away': { bg: '#FFC832', text: '#78350f', border: '#e6b42d' },
  'scorer-duty': { bg: '#6366f1', text: '#ffffff', border: '#4f46e5' },
  training: { bg: '#16a34a', text: '#ffffff', border: '#15803d' },
  event: { bg: '#7e22ce', text: '#ffffff', border: '#6b21a8' },
  hall: { bg: '#0891b2', text: '#ffffff', border: '#0e7490' },
  closure: { bg: '#dc2626', text: '#ffffff', border: '#b91c1c' },
  absence: { bg: '#374151', text: '#ffffff', border: '#1f2937' },
  birthday: { bg: '#ec4899', text: '#ffffff', border: '#db2777' },
}

/* ── key helpers ───────────────────────────────────────────── */

/** Colour-key from an entry — games split into home/away. */
export function colorKey(e: CalendarEntry): string {
  if (e.type === 'game' && e.gameType) return `game-${e.gameType}`
  return e.type
}

/** Palette key for colouring — honours an entry's `colorOverride`. The icon
 *  shape still follows `colorKey()`/`type`, so only the colour changes. */
export function paintKey(e: CalendarEntry): string {
  return e.colorOverride ?? colorKey(e)
}

/** `text-*` icon colour for the overflow modal. */
export function entryIconColor(entry: CalendarEntry): string {
  if (entry.type === 'game' && entry.gameType) return iconColors[`game-${entry.gameType}`] || 'text-brand-500'
  return iconColors[entry.type] || 'text-gray-500'
}

/** Chip class string for week/day time blocks. */
export function blockClasses(e: CalendarEntry): string {
  const c = barColors[colorKey(e)] ?? barColors.game
  return `${c.bg} ${c.text} ${c.darkBg} ${c.darkText}`
}

/**
 * Label classes for a cancelled entry — struck through and dimmed; empty for a
 * live one, so it composes into any className.
 *
 * Colour alone can't carry this: the palette above is keyed by *type*, and a
 * cancelled training has to stay green enough to still read as a training.
 * Apply it to whatever the view shows (time, title, or the whole row) rather
 * than to the title alone — most grids hide the title at narrow widths, and a
 * bare unstruck "18:00" is the same lie as before.
 */
export function cancelledClasses(e: CalendarEntry): string {
  return e.cancelled ? 'line-through opacity-60' : ''
}
