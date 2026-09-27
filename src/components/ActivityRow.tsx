import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { RAIL_WIDTH, ROW_TONE_STRIPE, ROW_TONE_TEXT, type RowTone } from './activityRowTokens'

/* ── Row vocabulary (ported from svrz_rc's GameRow, see /kscw-ui → "Rows") ──
 *
 *   ┌ rail ┐┃┌ body ─────────────────────────────┐ ┌ action ┐
 *   │ Sa   │┃│ Home team               status ●  │ │ (sm+)  │
 *   │ 12.10│┃│ Away team                          │ └────────┘
 *   │ 14:00│┃│ [chip] [chip] [chip]               │
 *   └──────┘┃└───────────────────────────────────┘
 *   [ tool ][ tool ][ tool ]   ← own line, indented to the body from sm
 *
 * - The rail is one fixed width app-wide, right-aligned, tabular — every
 *   body starts at the same x and dates line up on their right edge.
 * - State colour lives on the 2px stripe + the rail's main line, never on a
 *   filled box. The list (`RowList`) owns separators; rows draw no borders.
 * - Body is `min-w-0 flex-1`; everything trailing is `shrink-0`.
 * - Buttons never share a line with long primary text on a phone: `tools` is
 *   always its own line; `action` sits beside the row from `sm` and drops to a
 *   full-width line below it on a phone. Each is rendered ONCE and reflowed by
 *   flex-wrap + basis — never duplicated behind `sm:hidden`.
 */

/** A list of rows. Owns the hairlines between them. */
export function RowList({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('divide-y divide-gray-200 dark:divide-gray-700/70', className)}>{children}</div>
}

/** Fixed-width, right-aligned left column: weekday / main line / sub lines. */
export function DateRail({
  eyebrow, main, sub, extra, tone = 'gray', className,
}: {
  /** Tiny uppercase line above (weekday). */
  eyebrow?: ReactNode
  /** The bold line (date, or time for same-day lists). */
  main: ReactNode
  /** Second line (time). */
  sub?: ReactNode
  /** Further small lines (league, match no.). Wraps, never truncates. */
  extra?: ReactNode
  tone?: RowTone
  className?: string
}) {
  return (
    <div className={cn(RAIL_WIDTH, 'shrink-0 text-right leading-tight', className)}>
      {eyebrow && <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{eyebrow}</div>}
      <div className={cn('text-sm font-bold tabular-nums tracking-tight sm:text-[15px]', ROW_TONE_TEXT[tone])}>{main}</div>
      {sub && <div className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{sub}</div>}
      {extra && <div className="mt-0.5 break-words text-[10.5px] font-medium leading-snug text-gray-500 dark:text-gray-400 sm:text-[11px]">{extra}</div>}
    </div>
  )
}

/** The 2px state stripe between rail and body. */
export function RowStripe({ tone = 'gray' }: { tone?: RowTone }) {
  return <div className={cn('w-[2px] shrink-0 self-stretch rounded-full', ROW_TONE_STRIPE[tone])} aria-hidden />
}

export interface ActivityRowProps {
  /** Left column — usually a <DateRail>. */
  rail: ReactNode
  tone?: RowTone
  /** Primary line(s) — a <TeamPair>, or a title. Wraps; never truncate names here. */
  title: ReactNode
  /** Top-right, NOT a control (a dot, a pill, a count). */
  status?: ReactNode
  /** Chips row under the title — `flex-wrap items-stretch`, chips are nowrap blocks. */
  chips?: ReactNode
  /** Anything else inside the body (location line, RSVP counters, notes). */
  children?: ReactNode
  /** One primary control: beside the row from sm, full width under it on a phone. */
  action?: ReactNode
  /** Labelled toolbar on its own line under the row at every width (use <Button size="tool">). */
  tools?: ReactNode
  onClick?: () => void
  /** Dim the whole row (cancelled / past). */
  muted?: boolean
  className?: string
  'data-testid'?: string
}

/**
 * One activity as a flat row (games, trainings, events, rides, duties).
 * The clickable body is a `div role="button"` so real links/controls can sit
 * inside it; `action`/`tools` are its siblings, never its children.
 */
export function ActivityRow({
  rail, tone = 'gray', title, status, chips, children, action, tools, onClick, muted, className, ...rest
}: ActivityRowProps) {
  const interactive = !!onClick
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick || e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
  }
  return (
    <div data-testid={rest['data-testid']} className={cn('flex flex-wrap items-stretch py-0.5', muted && 'opacity-60', className)}>
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={interactive ? onKeyDown : undefined}
        className={cn(
          'flex min-w-0 flex-1 basis-0 items-stretch gap-2.5 px-1.5 py-2.5 text-left sm:gap-3 sm:px-2',
          interactive && 'cursor-pointer rounded-md transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-gray-800/60',
        )}
      >
        {rail}
        <RowStripe tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">{title}</div>
            {status && <span className="mt-0.5 flex shrink-0 items-center gap-1.5">{status}</span>}
          </div>
          {chips && <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5 empty:hidden">{chips}</div>}
          {children}
        </div>
      </div>
      {action && (
        <div className="flex basis-full items-center pb-2 pl-[5.25rem] pr-1.5 sm:basis-auto sm:pb-0 sm:pl-2 sm:pr-2">
          {action}
        </div>
      )}
      {tools && (
        <div className="flex basis-full items-center gap-1.5 px-1.5 pb-2.5 empty:hidden sm:gap-2 sm:pl-[6.625rem] sm:pr-2">
          {tools}
        </div>
      )}
    </div>
  )
}

/**
 * Home over away, as a grid. Home semibold, away regular (or whichever side is
 * ours); no "H:/A:" labels. Each aside (score) sits at the end of its own
 * team's line at every width. Cells are placed explicitly (col/row start):
 * with auto-placement a missing aside let the away name slide into the `auto`
 * column and squeezed the home name to a few characters per line.
 * Names WRAP (`break-words`), never truncate.
 */
export function TeamPair({
  home, away, homeAside, awayAside, emphasis = 'home', className,
}: {
  home: ReactNode
  away: ReactNode
  homeAside?: ReactNode
  awayAside?: ReactNode
  /** Which side is ours (bold). */
  emphasis?: 'home' | 'away' | 'both'
  className?: string
}) {
  const strong = 'font-semibold text-gray-900 dark:text-gray-100'
  const weak = 'text-gray-600 dark:text-gray-400'
  const hasAside = homeAside != null || awayAside != null
  return (
    <div className={cn('grid min-w-0 items-baseline gap-x-2', hasAside ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1', className)}>
      <div className={cn('col-start-1 row-start-1 min-w-0 break-words text-sm leading-snug sm:text-[15px]', emphasis !== 'away' ? strong : weak)}>{home}</div>
      {homeAside != null && <div className="col-start-2 row-start-1 text-right">{homeAside}</div>}
      <div className={cn('col-start-1 row-start-2 min-w-0 break-words text-sm leading-snug sm:text-[15px]', emphasis !== 'home' ? strong : weak)}>{away}</div>
      {awayAside != null && <div className="col-start-2 row-start-2 text-right">{awayAside}</div>}
    </div>
  )
}

export type ChipTone = 'gray' | 'brand' | 'green' | 'amber' | 'red' | 'sky' | 'violet' | 'solid'

const CHIP_TONE: Record<ChipTone, string> = {
  gray: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300',
  brand: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-200',
  green: 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  violet: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200',
  solid: 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900',
}

/**
 * Small metadata chip. `whitespace-nowrap` by default so it never splits
 * mid-word; pass `wrap` for chips that carry a person's name.
 */
export function RowChip({
  tone = 'gray', wrap, title, className, children,
}: { tone?: ChipTone; wrap?: boolean; title?: string; className?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-[3px] text-[10.5px] font-semibold leading-none sm:text-[11px] [&_svg]:size-2.5 [&_svg]:shrink-0',
        wrap ? 'whitespace-normal text-left leading-tight' : 'whitespace-nowrap',
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * Section heading on a rule — not a card. Title left, `shrink-0` cluster right
 * (tabular count, a small action, an info hint).
 */
export function SectionHead({
  title, icon, count, right, className, as: Tag = 'h3',
}: {
  title: ReactNode
  icon?: ReactNode
  count?: number | string
  right?: ReactNode
  className?: string
  as?: 'h2' | 'h3' | 'h4'
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2 border-b-[1.5px] border-gray-800 pb-1.5 dark:border-gray-300', className)}>
      <Tag className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200 [&_svg]:size-3.5 [&_svg]:shrink-0">
        {icon}
        <span className="min-w-0 break-words">{title}</span>
      </Tag>
      {(count != null || right) && (
        <span className="flex shrink-0 items-center gap-2">
          {count != null && <span className="text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">{count}</span>}
          {right}
        </span>
      )}
    </div>
  )
}
export type { RowTone } from './activityRowTokens'
