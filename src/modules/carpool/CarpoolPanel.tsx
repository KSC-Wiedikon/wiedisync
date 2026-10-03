import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Car, ChevronDown, LogOut, MapPin, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import { ActivityRow, DateRail, RowChip, SectionHead } from '@/components/ActivityRow'
import type { RowTone } from '@/components/activityRowTokens'
import { useConfirm } from '../../components/ConfirmProvider'
import { memberDisplayName } from '../../utils/relations'
import { formatDayMonthZurich, formatWeekdayZurich } from '../../utils/dateHelpers'
import {
  CARPOOL_ERROR_KEYS, useCarpoolActions, useCarpoolBoard,
  type CarpoolActivityType, type CarpoolDirection, type CarpoolEntryInput, type CarpoolKind, type CarpoolOffer, type CarpoolRequest,
} from './carpoolApi'
import {
  CARPOOL_DIRECTIONS, activityDays, canJoin, canOffer, canRequest, canTake, entryCount, firstFreeDay, myRideDays, myRole, seatsINeed,
} from './carpoolFormat'
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

/* Going and Return are two separate car pools (migration 393): each has its
 * own rides, passengers and requests; the tab strip picks which one the
 * buttons and the list act on. */

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
  const [leg, setLeg] = useState<CarpoolDirection>('there')
  const [busy, setBusy] = useState(false)

  if (isLoading || !res) return null
  const { activity, data: pool } = res
  // Scoped to teams the viewer is not in (migration 379) — not their board.
  if (res.in_scope === false) return null
  const hasEntries = entryCount(pool) > 0
  const board = pool[leg]
  if (!activity.enabled && !hasEntries) return null

  const open = activity.open
  // A multi-day activity takes one ride per way per day (migration 397).
  const days = activityDays(activity.date, activity.last_date)
  const multiDay = days.length > 1
  // Teams a ride can be offered to (migration 380) — the form's "For teams".
  const teamOptions = (res.activity_teams ?? []).map((tm) => ({ id: String(tm.id), label: tm.name, sport: tm.sport }))
  const teamName = new Map((res.activity_teams ?? []).map((tm) => [tm.id, tm.name]))
  const showBody = standalone || expanded || composer != null
  const role = myRole(pool)
  const switchLeg = (d: CarpoolDirection) => {
    setLeg(d)
    setComposer(null)
    if (hasEntries) setExpanded(true)
  }

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
                  t('rides', { count: pool.totals.offers }),
                  t('freeSeats', { count: pool.totals.seats_free }),
                  pool.totals.requests_open > 0 ? t('looking', { count: pool.totals.requests_open }) : null,
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
          <IconButton
            label={t('title')}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={showBody}
            className="text-sky-800 hover:bg-sky-100 hover:text-sky-900 dark:text-sky-200 dark:hover:bg-sky-900/50 dark:hover:text-sky-100"
          >
            <ChevronDown className={`!size-5 transition-transform ${showBody ? 'rotate-180' : ''}`} />
          </IconButton>
        )}
      </div>

      {/* Going | Return — two car pools, side by side at equal width. */}
      <div role="tablist" aria-label={t('title')} className="grid grid-cols-2 gap-1.5 px-3 pb-3">
        {CARPOOL_DIRECTIONS.map((d) => {
          const selected = leg === d
          const l = pool[d]
          const legRole = myRole(l)
          return (
            <Button
              key={d}
              type="button"
              role="tab"
              aria-selected={selected}
              variant="outline"
              onClick={() => switchLeg(d)}
              className={`gap-1.5 px-2 ${
                selected
                  ? 'border-sky-600 bg-sky-600 text-white hover:bg-sky-600 hover:text-white dark:border-sky-500 dark:bg-sky-600'
                  : 'border-sky-200 bg-card text-foreground/85 hover:bg-sky-50 dark:border-sky-900 dark:hover:bg-sky-950/50'
              }`}
            >
              <span>{t(`tab_${d}`)}</span>
              {l.offers.length + l.requests.length > 0 && (
                <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${selected ? 'bg-white/25' : 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200'}`}>
                  {l.offers.length}
                </span>
              )}
              {legRole && <span className="sr-only">{t(`role_${legRole}`)}</span>}
              {legRole && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-sky-600 dark:bg-sky-400'}`} />}
            </Button>
          )
        })}
      </div>

      {/* The two ways in, side by side at equal width — never stacked. */}
      {open && composer == null && (canOffer(board, open, multiDay) || canRequest(board, open, multiDay)) && (
        <div className="flex gap-2 px-3 pb-3">
          {canOffer(board, open, multiDay) && (
            <Button type="button" size="tool" onClick={() => setComposer({ kind: 'offer' })} icon={<Car aria-hidden />}>
              {t('offerRide')}
            </Button>
          )}
          {canRequest(board, open, multiDay) && (
            <Button type="button" size="tool" variant="outline" onClick={() => setComposer({ kind: 'request' })} icon={<UserPlus aria-hidden />}>
              {t('requestRide')}
            </Button>
          )}
        </div>
      )}

      {showBody && (
        <div className="space-y-4 border-t border-sky-200 p-3 dark:border-sky-900">
          {composer && (
            <CarpoolEntryForm
              key={`${leg}-${composer.kind}-${composer.editId ?? 'new'}`}
              kind={composer.kind}
              direction={leg}
              // The next day without a ride of mine: Going from the first day,
              // Return from the last.
              defaultDate={firstFreeDay(
                leg === 'back' ? [...days].reverse() : days,
                myRideDays(board, composer.kind),
                leg === 'back' ? (activity.last_date ?? activity.date) : activity.date,
              )}
              takenDays={myRideDays(board, composer.kind, composer.editId)}
              initial={editing ? {
                direction: editing.direction,
                seats: editing.seats,
                departure_date: editing.departure_date,
                departure_time: editing.departure_time,
                teams: editing.teams,
                departure_location: editing.departure_location,
                notes: editing.notes,
              } : undefined}
              minSeats={editing?.kind === 'offer' ? Math.max(1, editing.seats_taken) : 1}
              suggestedTime={leg === 'there' ? suggestedTime : null}
              teamOptions={teamOptions}
              onSubmit={submitComposer}
              onCancel={() => setComposer(null)}
            />
          )}

          {board.offers.length + board.requests.length === 0 && composer == null && (
            <p className="text-center text-xs text-sky-900/70 dark:text-sky-200/70">{t(`emptyLeg_${leg}`)}</p>
          )}

          {board.offers.length > 0 && (
            <div>
              <SectionHead as="h4" className="mb-1" title={t('offersHeading')} count={board.offers.length} />
              <div className="divide-y divide-sky-200/70 dark:divide-sky-900/70">
                {board.offers.map((o) => (
                  <RideRow
                    key={o.id}
                    entry={o}
                    tone={o.mine ? 'mine' : o.seats_free === 0 ? 'full' : 'open'}
                    status={o.seats_free > 0
                      ? <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{t('seatsFree', { free: o.seats_free, total: o.seats })}</span>
                      : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">{t('full')}</span>}
                    chips={<>
                      {o.mine && <RowChip tone="sky">{t('youDrive')}</RowChip>}
                      {o.i_am_passenger && <RowChip tone="sky">{t('youRide')}</RowChip>}
                      {o.teams.length > 0 && <RowChip tone="violet" wrap>{t('forTeamsList', { teams: o.teams.map((tid) => teamName.get(tid)).filter(Boolean).join(', ') })}</RowChip>}
                    </>}
                    tools={<>
                      {canJoin(board, o, open) && (
                        <Button type="button" size="tool" disabled={busy} onClick={() => act(() => actions.join(o.id, seatsINeed(board, o.departure_date)), 'joined').catch(() => {})} icon={<UserPlus aria-hidden />}>
                          {t('join')}
                        </Button>
                      )}
                      {o.i_am_passenger && (
                        <Button type="button" size="tool" variant="outline" disabled={busy} onClick={() => leave(o)} icon={<LogOut aria-hidden />}>
                          {t('leave')}
                        </Button>
                      )}
                      {o.mine && open && (
                        <Button type="button" size="tool" variant="outline" disabled={busy} onClick={() => setComposer({ kind: 'offer', editId: o.id })} icon={<Pencil aria-hidden />}>
                          {t('edit')}
                        </Button>
                      )}
                      {o.mine && (
                        <Button type="button" size="tool" variant="outline" disabled={busy} onClick={() => withdraw(o)} className={DANGER_OUTLINE} icon={<Trash2 aria-hidden />}>
                          {t('withdraw')}
                        </Button>
                      )}
                    </>}
                  >
                    {o.passengers.length > 0 && (
                      <div className="mt-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('passengers')}</div>
                        <ul className="mt-0.5 flex flex-wrap gap-1.5">
                          {o.passengers.map((p) => {
                            const name = memberDisplayName(p.member)
                            return (
                              <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-xs text-foreground">
                                <span>{name}{p.seats > 1 ? ` · ${t('seatsTaken', { count: p.seats })}` : ''}</span>
                                {o.mine ? (
                                  // Sits inside a name pill, so it keeps the pill's 28px
                                  // instead of the 36/32 icon-sm tier — a full-height
                                  // button would double every passenger chip.
                                  <IconButton
                                    size="sm"
                                    label={`${t('remove')} ${name}`}
                                    disabled={busy}
                                    onClick={() => dropPassenger(p.id, name)}
                                    className="h-7 w-7 rounded-full text-muted-foreground/80 hover:bg-red-50 hover:text-red-600 sm:h-7 sm:w-7 dark:hover:bg-red-900/30 dark:hover:text-red-400 [&_svg]:size-3.5"
                                  >
                                    <X />
                                  </IconButton>
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
              <SectionHead as="h4" className="mb-1" title={t('requestsHeading')} count={board.requests.filter((r) => !r.covered).length} />
              <div className="divide-y divide-sky-200/70 dark:divide-sky-900/70">
                {board.requests.map((r) => (
                  <RideRow
                    key={r.id}
                    entry={r}
                    tone={r.covered ? 'done' : r.mine ? 'mine' : 'waiting'}
                    status={<span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">{t('seatsTaken', { count: r.seats })}</span>}
                    chips={<>
                      {r.mine && <RowChip tone="sky">{t('you')}</RowChip>}
                      {r.covered && <RowChip tone="green" wrap>{t('hasRide')} · {t('withDriver', { name: r.covered_by.map((d) => memberDisplayName(d)).join(', ') })}</RowChip>}
                    </>}
                    tools={<>
                      {canTake(board, r, open) && (
                        <Button type="button" size="tool" disabled={busy} onClick={() => act(() => actions.take(r.id), 'taken', { name: memberDisplayName(r.member) }).catch(() => {})} icon={<UserPlus aria-hidden />}>
                          {t('take')}
                        </Button>
                      )}
                      {r.mine && open && (
                        <Button type="button" size="tool" variant="outline" disabled={busy} onClick={() => setComposer({ kind: 'request', editId: r.id })} icon={<Pencil aria-hidden />}>
                          {t('edit')}
                        </Button>
                      )}
                      {r.mine && (
                        <Button type="button" size="tool" variant="outline" disabled={busy} onClick={() => withdraw(r)} className={DANGER_OUTLINE} icon={<Trash2 aria-hidden />}>
                          {t('withdraw')}
                        </Button>
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

/* ── Ride rows on the shared row vocabulary (ActivityRow, svrz_rc's GameRow) ──
 * The rail answers "when" (and which way), the 2px stripe says the row's state,
 * the body carries the person and the facts as chips, and the row's own
 * buttons sit on a line of their own underneath — side by side at equal width
 * on a phone, where a column of stacked buttons squeezed the name into two
 * lines and pushed every row twice as tall. */

/** Outline tool button with a destructive label (withdraw). */
const DANGER_OUTLINE = 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300'

type RideTone = 'mine' | 'open' | 'full' | 'waiting' | 'done'
const RIDE_TONE: Record<RideTone, RowTone> = {
  mine: 'sky',
  open: 'green',
  full: 'red',
  waiting: 'amber',
  done: 'gray',
}

function RideRow({ entry, tone, status, chips, tools, children }: {
  entry: CarpoolOffer | CarpoolRequest
  tone: RideTone
  status: ReactNode
  chips?: ReactNode
  tools?: ReactNode
  children?: ReactNode
}) {
  const person = entry.member
  const first = (person.nickname && person.nickname.trim()) || person.first_name
  return (
    <ActivityRow
      tone={RIDE_TONE[tone]}
      muted={tone === 'done'}
      rail={
        <DateRail
          tone={RIDE_TONE[tone]}
          eyebrow={entry.departure_date ? formatWeekdayZurich(entry.departure_date) : undefined}
          main={entry.departure_time ?? '–'}
          sub={entry.departure_date ? formatDayMonthZurich(entry.departure_date) : undefined}
        />
      }
      // The pickup point rides with the name (above the chips), as before.
      title={<>
        <p className="text-sm font-semibold leading-snug text-foreground break-words">
          {first} {person.last_name}
        </p>
        {entry.departure_location && (
          <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span className="break-words">{entry.departure_location}</span>
          </p>
        )}
      </>}
      status={status}
      chips={chips}
      tools={tools}
    >
      {entry.notes && <p className="mt-1 text-xs italic text-muted-foreground">{entry.notes}</p>}
      {children}
    </ActivityRow>
  )
}
