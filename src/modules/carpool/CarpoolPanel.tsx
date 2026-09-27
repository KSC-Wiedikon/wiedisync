import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Car, ChevronDown, Phone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConfirm } from '../../components/ConfirmProvider'
import { memberDisplayName } from '../../utils/relations'
import {
  CARPOOL_ERROR_KEYS, useCarpoolActions, useCarpoolBoard,
  type CarpoolActivityType, type CarpoolBoard, type CarpoolEntryInput, type CarpoolKind, type CarpoolOffer, type CarpoolRequest,
} from './carpoolApi'
import { canJoin, canOffer, canRequest, canTake, myRole, seatsINeed, telHref } from './carpoolFormat'
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
  const hasEntries = board.offers.length + board.requests.length > 0
  if (!activity.enabled && !hasEntries) return null

  const open = activity.open
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
      {/* Banner */}
      <div className="flex items-start gap-3 p-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white dark:bg-sky-500 dark:text-sky-950">
          <Car className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-sky-950 dark:text-sky-100">{t('title')}</h3>
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
          {!open && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{activity.enabled ? t('closedHint') : t('errorDisabled')}</p>}
          {open && composer == null && (canOffer(board, open) || canRequest(board, open)) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {canOffer(board, open) && (
                <Button size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => setComposer({ kind: 'offer' })}>
                  {t('offerRide')}
                </Button>
              )}
              {canRequest(board, open) && (
                <Button size="sm" variant="outline" className="min-h-[44px] bg-white sm:min-h-0 dark:bg-gray-900" onClick={() => setComposer({ kind: 'request' })}>
                  {t('requestRide')}
                </Button>
              )}
            </div>
          )}
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
                departure_location: editing.departure_location,
                notes: editing.notes,
              } : undefined}
              minSeats={editing?.kind === 'offer' ? Math.max(1, editing.seats_taken) : 1}
              suggestedTime={suggestedTime}
              onSubmit={submitComposer}
              onCancel={() => setComposer(null)}
            />
          )}

          {board.offers.length > 0 && (
            <OffersTable
              board={board}
              open={open}
              busy={busy}
              onJoin={(o) => act(() => actions.join(o.id, seatsINeed(board)), 'joined').catch(() => {})}
              onLeave={leave}
              onEdit={(o) => setComposer({ kind: 'offer', editId: o.id })}
              onWithdraw={withdraw}
              onDrop={dropPassenger}
            />
          )}

          {board.requests.length > 0 && (
            <RequestsTable
              board={board}
              open={open}
              busy={busy}
              onTake={(r) => act(() => actions.take(r.id), 'taken', { name: memberDisplayName(r.member) }).catch(() => {})}
              onEdit={(r) => setComposer({ kind: 'request', editId: r.id })}
              onWithdraw={withdraw}
            />
          )}
        </div>
      )}
    </section>
  )
}

function DirectionTimePlace({ entry }: { entry: CarpoolOffer | CarpoolRequest }) {
  const { t } = useTranslation('carpool')
  return (
    <div className="space-y-0.5">
      <div className="text-sm text-gray-900 dark:text-gray-100">
        {entry.departure_time && <span className="font-medium tabular-nums">{entry.departure_time}</span>}
        {entry.departure_time && ' · '}
        <span className="text-gray-600 dark:text-gray-400">{t(`direction_${entry.direction}`)}</span>
      </div>
      {entry.departure_location && <div className="text-xs text-gray-600 dark:text-gray-400">{entry.departure_location}</div>}
      {entry.notes && <div className="text-xs italic text-gray-500 dark:text-gray-400">{entry.notes}</div>}
    </div>
  )
}

function NameCell({ person, badge }: { person: CarpoolOffer['member']; badge?: string | null }) {
  const { t } = useTranslation('carpool')
  const href = telHref(person.phone)
  return (
    <div className="space-y-0.5">
      {/* Two lines on mobile (last / first), never truncated — table rule (a). */}
      <div className="font-medium text-gray-900 dark:text-gray-100">
        <span className="block sm:inline">{person.last_name}</span>{' '}
        <span className="block sm:inline">{(person.nickname && person.nickname.trim()) || person.first_name}</span>
      </div>
      {badge && <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">{badge}</span>}
      {href && (
        <a href={href} className="flex min-h-[32px] items-center gap-1 whitespace-nowrap text-xs text-brand-600 hover:underline dark:text-brand-400" aria-label={`${t('call')} ${person.phone}`}>
          <Phone className="h-3.5 w-3.5" aria-hidden />{person.phone}
        </a>
      )}
    </div>
  )
}

// Actions render twice: under the name on phones (stacked, ≥44px targets —
// table rules (c)/(e)), and in their own column from sm up. A fourth column
// does not fit a 390px screen next to three wrapped text columns.
const actionsMobile = 'mt-2 flex flex-col items-stretch gap-1.5 sm:hidden [&>button]:min-h-[44px]'
const actionsDesktop = 'flex items-center justify-end gap-1.5'

function OffersTable({ board, open, busy, onJoin, onLeave, onEdit, onWithdraw, onDrop }: {
  board: CarpoolBoard
  open: boolean
  busy: boolean
  onJoin: (o: CarpoolOffer) => void
  onLeave: (o: CarpoolOffer) => void
  onEdit: (o: CarpoolOffer) => void
  onWithdraw: (o: CarpoolOffer) => void
  onDrop: (rowId: number, name: string) => void
}) {
  const { t } = useTranslation('carpool')
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('offersHeading')}</h4>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colDriver')}</TableHead>
              <TableHead>{t('colDeparture')}</TableHead>
              <TableHead className="text-center">{t('colSeats')}</TableHead>
              <TableHead className="hidden w-0 sm:table-cell"><span className="sr-only">{t('edit')}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {board.offers.map((o) => {
              const actions = (
                <>
                  {o.mine && open && <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(o)}>{t('edit')}</Button>}
                  {o.mine && <Button size="sm" variant="outline" disabled={busy} onClick={() => onWithdraw(o)} className="text-red-600 dark:text-red-400">{t('withdraw')}</Button>}
                  {o.i_am_passenger && <Button size="sm" variant="outline" disabled={busy} onClick={() => onLeave(o)}>{t('leave')}</Button>}
                  {canJoin(board, o, open) && <Button size="sm" disabled={busy} onClick={() => onJoin(o)}>{t('join')}</Button>}
                </>
              )
              return (
              <TableRow key={o.id} className="align-top">
                <TableCell className="min-h-[44px] whitespace-normal py-2.5">
                  <NameCell person={o.member} badge={o.mine ? t('youDrive') : o.i_am_passenger ? t('youRide') : null} />
                  {o.passengers.length > 0 && (
                    <ul className="mt-1.5 space-y-1 border-l-2 border-sky-200 pl-2 dark:border-sky-800">
                      {o.passengers.map((p) => {
                        const name = memberDisplayName(p.member)
                        const href = telHref(p.member.phone)
                        return (
                          <li key={p.id} className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
                            <span className="min-w-0">
                              <span className="block">{name}{p.seats > 1 ? ` (${t('seatsTaken', { count: p.seats })})` : ''}</span>
                              {href && <a href={href} className="block whitespace-nowrap text-brand-600 hover:underline dark:text-brand-400">{p.member.phone}</a>}
                            </span>
                            {o.mine && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => onDrop(p.id, name)}
                                aria-label={`${t('remove')} ${name}`}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <div className={actionsMobile}>{actions}</div>
                </TableCell>
                <TableCell className="whitespace-normal py-2.5"><DirectionTimePlace entry={o} /></TableCell>
                <TableCell className="py-2.5 text-center">
                  {o.seats_free > 0
                    ? <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{t('seatsFree', { free: o.seats_free, total: o.seats })}</span>
                    : <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">{t('full')}</span>}
                </TableCell>
                <TableCell className="hidden py-2.5 sm:table-cell">
                  <div className={actionsDesktop}>{actions}</div>
                </TableCell>
              </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function RequestsTable({ board, open, busy, onTake, onEdit, onWithdraw }: {
  board: CarpoolBoard
  open: boolean
  busy: boolean
  onTake: (r: CarpoolRequest) => void
  onEdit: (r: CarpoolRequest) => void
  onWithdraw: (r: CarpoolRequest) => void
}) {
  const { t } = useTranslation('carpool')
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('requestsHeading')}</h4>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colPerson')}</TableHead>
              <TableHead>{t('colDeparture')}</TableHead>
              <TableHead className="text-center">{t('colSeats')}</TableHead>
              <TableHead className="hidden w-0 sm:table-cell"><span className="sr-only">{t('edit')}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {board.requests.map((r) => {
              const actions = (
                <>
                  {r.mine && open && <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(r)}>{t('edit')}</Button>}
                  {r.mine && <Button size="sm" variant="outline" disabled={busy} onClick={() => onWithdraw(r)} className="text-red-600 dark:text-red-400">{t('withdraw')}</Button>}
                  {canTake(board, r, open) && <Button size="sm" disabled={busy} onClick={() => onTake(r)}>{t('take')}</Button>}
                </>
              )
              return (
              <TableRow key={r.id} className={`align-top ${r.covered ? 'opacity-70' : ''}`}>
                <TableCell className="whitespace-normal py-2.5">
                  <NameCell person={r.member} badge={r.mine ? t('you') : null} />
                  {r.covered && (
                    <p className="mt-1 text-xs font-medium text-green-700 dark:text-green-400">
                      {t('hasRide')} · {t('withDriver', { name: r.covered_by.map((d) => memberDisplayName(d)).join(', ') })}
                    </p>
                  )}
                  <div className={actionsMobile}>{actions}</div>
                </TableCell>
                <TableCell className="whitespace-normal py-2.5"><DirectionTimePlace entry={r} /></TableCell>
                <TableCell className="py-2.5 text-center text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">{r.seats}</TableCell>
                <TableCell className="hidden py-2.5 sm:table-cell">
                  <div className={actionsDesktop}>{actions}</div>
                </TableCell>
              </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
