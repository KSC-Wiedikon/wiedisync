import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Car, ChevronDown, LogOut, MapPin, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirm } from '../../components/ConfirmProvider'
import { memberDisplayName } from '../../utils/relations'
import {
  CARPOOL_ERROR_KEYS, useCarpoolActions, useCarpoolBoard,
  type CarpoolActivityType, type CarpoolEntryInput, type CarpoolKind, type CarpoolOffer, type CarpoolRequest,
} from './carpoolApi'
import { canJoin, canOffer, canRequest, canTake, myRole, seatsINeed } from './carpoolFormat'
import CarpoolEntryForm from './CarpoolEntryForm'

interface CarpoolPanelProps {
  type: CarpoolActivityType
  id: string | number
  /** Standalone (dialog / page): always expanded, no collapse chevron. */
  standalone?: boolean
  /** Suggested departure time for a new offer (e.g. the meeting time). */
  suggestedTime?: string | null
  /** Open the board expanded (e.g. when the user came through a car pooling link). */
  defaultExpanded?: boolean
}

type Composer = { kind: CarpoolKind; editId?: number } | null

/**
 * Car pooling banner + board for one game, training or event (migration 378).
 * Renders nothing unless the activity has car pooling switched on (or still
 * carries rides from before it was switched off, so nobody loses sight of the
 * car they are in).
 */
export default function CarpoolPanel({ type, id, standalone = false, suggestedTime, defaultExpanded = false }: CarpoolPanelProps) {
  const { t } = useTranslation('carpool')
  const confirm = useConfirm()
  const { data: res, isLoading } = useCarpoolBoard(type, id)
  const actions = useCarpoolActions(type, id)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [composer, setComposer] = useState<Composer>(null)
  const [busy, setBusy] = useState(false)

  if (isLoading || !res) return null
  const { activity, data: board } = res
  // Scoped to teams the viewer is not in (migration 379) — not their board.
  if (res.in_scope === false) return null
  const hasEntries = board.offers.length + board.requests.length > 0
  if (!activity.enabled && !hasEntries) return null

  const open = activity.open
  // Teams a ride can be offered to (migration 380) — the form's "For teams".
  const teamOptions = (res.activity_teams ?? []).map((tm) => ({ id: String(tm.id), label: tm.name, sport: tm.sport }))
  const teamName = new Map((res.activity_teams ?? []).map((tm) => [tm.id, tm.name]))
  const showBody = standalone || expanded || composer != null
  const role = myRole(board)

  const act = async (fn: () => Promise<unknown>, okKey?: string, vars?: Record<string, unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      if (okKey) toast.success(t(okKey, vars))
    } catch (err) {
      const code = (err as { code?: string })?.code
      toast.error(t(code && CARPOOL_ERROR_KEYS[code] ? CARPOOL_ERROR_KEYS[code] : 'errorGeneric'))
      // A 409 (someone took the last seat) means our copy is stale.
      void actions.refresh()
      throw err
    } finally {
      setBusy(false)
    }
  }

  const submitComposer = async (input: CarpoolEntryInput) => {
    if (!composer) return
    try {
      if (composer.editId != null) await act(() => actions.update(composer.editId!, input), 'saved')
      else await act(() => actions.create({ ...input, kind: composer.kind }), composer.kind === 'offer' ? 'offerPosted' : 'requestPosted')
      setComposer(null)
    } catch { /* toast already shown, keep the form open with its input */ }
  }

  const withdraw = async (entry: CarpoolOffer | CarpoolRequest) => {
    const withRiders = entry.kind === 'offer' && entry.passengers.length > 0
    if (!(await confirm({ message: t(withRiders ? 'confirmWithdrawOffer' : 'confirmWithdraw'), danger: true }))) return
    await act(() => actions.withdraw(entry.id), 'withdrawn').catch(() => {})
  }

  const leave = async (offer: CarpoolOffer) => {
    if (!(await confirm({ message: t('confirmLeave'), danger: true }))) return
    await act(() => actions.leave(offer.id), 'left').catch(() => {})
  }

  const dropPassenger = async (rowId: number, name: string) => {
    if (!(await confirm({ message: t('confirmRemove', { name }), danger: true }))) return
    await act(() => actions.dropPassenger(rowId), 'removed').catch(() => {})
  }

  const editing = composer?.editId != null
    ? [...board.offers, ...board.requests].find((e) => e.id === composer.editId)
    : undefined

  return (
    <section
      aria-label={t('title')}
      className="rounded-xl border border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30"
    >
      {/* Banner — in a dialog/page the title already says "Car pooling", so the
          banner drops its own heading and leads with the numbers. */}
      <div className="flex items-start gap-3 p-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white dark:bg-sky-500 dark:text-sky-950">
          <Car className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {!standalone && <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-100">{t('title')}</h3>}
            {role && (
              <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-sky-500 dark:text-sky-950">
                {t(`role_${role}`)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-sky-900/80 dark:text-sky-200/80">
            {hasEntries
              ? [
                  t('rides', { count: board.totals.offers }),
                  t('freeSeats', { count: board.totals.seats_free }),
                  board.totals.requests_open > 0 ? t('looking', { count: board.totals.requests_open }) : null,
                ].filter(Boolean).join(' · ')
              : t('emptyHint')}
          </p>
          {res.scope_teams?.length > 0 && (
            <p className="mt-0.5 text-xs text-sky-900/80 dark:text-sky-200/80">
              {t('openTo', { teams: res.scope_teams.map((tm) => tm.name).join(', ') })}
            </p>
          )}
          {!open && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{activity.enabled ? t('closedHint') : t('errorDisabled')}</p>}
        </div>
        {!standalone && hasEntries && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={showBody}
            aria-label={t('title')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sky-800 hover:bg-sky-100 dark:text-sky-200 dark:hover:bg-sky-900/50"
          >
            <ChevronDown className={`h-5 w-5 transition-transform ${showBody ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* The two ways in, side by side at equal width — never stacked. */}
      {open && composer == null && (canOffer(board, open) || canRequest(board, open)) && (
        <div className="flex gap-2 px-3 pb-3">
          {canOffer(board, open) && (
            <button type="button" onClick={() => setComposer({ kind: 'offer' })} className={cn(TOOL_BTN, TOOL_PRIMARY)}>
              <Car className="h-4 w-4 shrink-0" aria-hidden />{t('offerRide')}
            </button>
          )}
          {canRequest(board, open) && (
            <button type="button" onClick={() => setComposer({ kind: 'request' })} className={cn(TOOL_BTN, TOOL_OUTLINE)}>
              <UserPlus className="h-4 w-4 shrink-0" aria-hidden />{t('requestRide')}
            </button>
          )}
        </div>
      )}

      {showBody && (
        <div className="space-y-4 border-t border-sky-200 p-3 dark:border-sky-900">
          {composer && (
            <CarpoolEntryForm
              key={`${composer.kind}-${composer.editId ?? 'new'}`}
              kind={composer.kind}
              initial={editing ? {
                direction: editing.direction,
                seats: editing.seats,
                departure_time: editing.departure_time,
                return_time: editing.return_time,
                teams: editing.teams,
                departure_location: editing.departure_location,
                notes: editing.notes,
              } : undefined}
              minSeats={editing?.kind === 'offer' ? Math.max(1, editing.seats_taken) : 1}
              suggestedTime={suggestedTime}
              teamOptions={teamOptions}
              onSubmit={submitComposer}
              onCancel={() => setComposer(null)}
            />
          )}

          {board.offers.length > 0 && (
            <div>
              <SectionHead title={t('offersHeading')} count={board.offers.length} />
              <div className="divide-y divide-sky-200/70 dark:divide-sky-900/70">
                {board.offers.map((o) => (
                  <RideRow
                    key={o.id}
                    entry={o}
                    tone={o.mine ? 'mine' : o.seats_free === 0 ? 'full' : 'open'}
                    status={o.seats_free > 0
                      ? <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{t('seatsFree', { free: o.seats_free, total: o.seats })}</span>
                      : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">{t('full')}</span>}
                    chips={<>
                      {o.mine && <Chip tone="sky">{t('youDrive')}</Chip>}
                      {o.i_am_passenger && <Chip tone="sky">{t('youRide')}</Chip>}
                      {o.teams.length > 0 && <Chip tone="violet">{t('forTeamsList', { teams: o.teams.map((tid) => teamName.get(tid)).filter(Boolean).join(', ') })}</Chip>}
                    </>}
                    tools={<>
                      {canJoin(board, o, open) && (
                        <button type="button" disabled={busy} onClick={() => act(() => actions.join(o.id, seatsINeed(board)), 'joined').catch(() => {})} className={cn(TOOL_BTN, TOOL_PRIMARY)}>
                          <UserPlus className="h-4 w-4 shrink-0" aria-hidden />{t('join')}
                        </button>
                      )}
                      {o.i_am_passenger && (
                        <button type="button" disabled={busy} onClick={() => leave(o)} className={cn(TOOL_BTN, TOOL_OUTLINE)}>
                          <LogOut className="h-4 w-4 shrink-0" aria-hidden />{t('leave')}
                        </button>
                      )}
                      {o.mine && open && (
                        <button type="button" disabled={busy} onClick={() => setComposer({ kind: 'offer', editId: o.id })} className={cn(TOOL_BTN, TOOL_OUTLINE)}>
                          <Pencil className="h-4 w-4 shrink-0" aria-hidden />{t('edit')}
                        </button>
                      )}
                      {o.mine && (
                        <button type="button" disabled={busy} onClick={() => withdraw(o)} className={cn(TOOL_BTN, TOOL_DANGER)}>
                          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />{t('withdraw')}
                        </button>
                      )}
                    </>}
                  >
                    {o.passengers.length > 0 && (
                      <div className="mt-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('passengers')}</div>
                        <ul className="mt-0.5 flex flex-wrap gap-1.5">
                          {o.passengers.map((p) => {
                            const name = memberDisplayName(p.member)
                            return (
                              <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white py-0.5 pl-2.5 pr-1 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                                <span>{name}{p.seats > 1 ? ` · ${t('seatsTaken', { count: p.seats })}` : ''}</span>
                                {o.mine ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => dropPassenger(p.id, name)}
                                    aria-label={`${t('remove')} ${name}`}
                                    className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                ) : <span className="w-1.5" />}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )}
                  </RideRow>
                ))}
              </div>
            </div>
          )}

          {board.requests.length > 0 && (
            <div>
              <SectionHead title={t('requestsHeading')} count={board.requests.filter((r) => !r.covered).length} />
              <div className="divide-y divide-sky-200/70 dark:divide-sky-900/70">
                {board.requests.map((r) => (
                  <RideRow
                    key={r.id}
                    entry={r}
                    tone={r.covered ? 'done' : r.mine ? 'mine' : 'waiting'}
                    status={<span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{t('seatsTaken', { count: r.seats })}</span>}
                    chips={<>
                      {r.mine && <Chip tone="sky">{t('you')}</Chip>}
                      {r.covered && <Chip tone="emerald">{t('hasRide')} · {t('withDriver', { name: r.covered_by.map((d) => memberDisplayName(d)).join(', ') })}</Chip>}
                    </>}
                    tools={<>
                      {canTake(board, r, open) && (
                        <button type="button" disabled={busy} onClick={() => act(() => actions.take(r.id), 'taken', { name: memberDisplayName(r.member) }).catch(() => {})} className={cn(TOOL_BTN, TOOL_PRIMARY)}>
                          <UserPlus className="h-4 w-4 shrink-0" aria-hidden />{t('take')}
                        </button>
                      )}
                      {r.mine && open && (
                        <button type="button" disabled={busy} onClick={() => setComposer({ kind: 'request', editId: r.id })} className={cn(TOOL_BTN, TOOL_OUTLINE)}>
                          <Pencil className="h-4 w-4 shrink-0" aria-hidden />{t('edit')}
                        </button>
                      )}
                      {r.mine && (
                        <button type="button" disabled={busy} onClick={() => withdraw(r)} className={cn(TOOL_BTN, TOOL_DANGER)}>
                          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />{t('withdraw')}
                        </button>
                      )}
                    </>}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/* ── Row vocabulary — aligned with svrz_rc's GameRow ────────────────────────
 * A rail on the left answers "when" (and which way), a coloured hairline says
 * the row's state, the body carries the person and the facts as chips, and
 * the row's own buttons sit on a line of their own underneath — side by side
 * at equal width on a phone, where a column of stacked buttons squeezed the
 * name into two lines and pushed every row twice as tall. */

// ≥44px on a phone (house touch rule), svrz_rc's compact h-8 from sm up.
const TOOL_BTN = 'inline-flex h-11 flex-1 basis-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[13px] font-medium transition-colors disabled:opacity-50 sm:h-8 sm:flex-none sm:basis-auto sm:px-3 sm:text-xs'
const TOOL_PRIMARY = 'bg-primary text-primary-foreground hover:bg-primary/90'
const TOOL_OUTLINE = 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
const TOOL_DANGER = 'border border-gray-300 bg-white text-red-600 hover:bg-red-50 dark:border-gray-600 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-950/40'

type RowTone = 'mine' | 'open' | 'full' | 'waiting' | 'done'
const RAIL: Record<RowTone, string> = {
  mine: 'bg-sky-500',
  open: 'bg-emerald-400 dark:bg-emerald-500',
  full: 'bg-red-400 dark:bg-red-500',
  waiting: 'bg-amber-400 dark:bg-amber-500',
  done: 'bg-gray-300 dark:bg-gray-600',
}
const TIME_TEXT: Record<RowTone, string> = {
  mine: 'text-sky-700 dark:text-sky-300',
  open: 'text-emerald-700 dark:text-emerald-400',
  full: 'text-red-600 dark:text-red-400',
  waiting: 'text-amber-700 dark:text-amber-400',
  done: 'text-gray-500 dark:text-gray-400',
}

const CHIP: Record<'sky' | 'violet' | 'emerald' | 'stone', string> = {
  sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  violet: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  stone: 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
}

function Chip({ tone = 'stone', children }: { tone?: keyof typeof CHIP; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-[3px] text-[11px] font-semibold leading-tight', CHIP[tone])}>
      {children}
    </span>
  )
}

function SectionHead({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2 border-b-[1.5px] border-gray-800 pb-1.5 dark:border-gray-300">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">{title}</h4>
      <span className="text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">{count}</span>
    </div>
  )
}

function RideRow({ entry, tone, status, chips, tools, children }: {
  entry: CarpoolOffer | CarpoolRequest
  tone: RowTone
  status: React.ReactNode
  chips?: React.ReactNode
  tools?: React.ReactNode
  children?: React.ReactNode
}) {
  const { t } = useTranslation('carpool')
  const person = entry.member
  const first = (person.nickname && person.nickname.trim()) || person.first_name
  return (
    <div className={cn('flex flex-wrap items-stretch py-0.5', tone === 'done' && 'opacity-70')}>
      <div className="flex min-w-0 flex-1 basis-0 items-stretch gap-2.5 px-1 py-2.5 sm:gap-3">
        {/* Rail: when, and which way. */}
        <div className="w-14 shrink-0 text-right leading-tight sm:w-16">
          <div className={cn('text-sm font-bold tabular-nums', TIME_TEXT[tone])}>{entry.departure_time ?? '–'}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">{t(`direction_${entry.direction}`)}</div>
          {entry.direction === 'both' && entry.return_time && (
            <div className="mt-0.5 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">↩ {entry.return_time}</div>
          )}
        </div>
        <div className={cn('w-[2px] shrink-0 self-stretch rounded-full', RAIL[tone])} aria-hidden />
        {/* Body: who, then the facts as chips, then anything the list adds. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-gray-900 break-words dark:text-gray-100">
              {first} {person.last_name}
            </p>
            <span className="mt-0.5 shrink-0">{status}</span>
          </div>
          {entry.departure_location && (
            <p className="mt-0.5 flex items-start gap-1 text-xs text-gray-600 dark:text-gray-400">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="break-words">{entry.departure_location}</span>
            </p>
          )}
          {chips && <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5 empty:hidden">{chips}</div>}
          {entry.notes && <p className="mt-1 text-xs italic text-gray-500 dark:text-gray-400">{entry.notes}</p>}
          {children}
        </div>
      </div>
      {/* The row's own buttons, on a line of their own under it. */}
      {tools && (
        <div className="flex basis-full items-center gap-1.5 px-1 pb-2.5 empty:hidden sm:gap-2 sm:pl-[5.75rem]">
          {tools}
        </div>
      )}
    </div>
  )
}
