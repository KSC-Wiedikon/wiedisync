import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, Send, Undo2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { useConfirm } from '../../../components/ConfirmProvider'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { proposalStatusOf, type BbOfferRow, type BbProposalStatus } from '../hooks/useBasketballOffers'
import type { BasketplanClub } from '../hooks/useBasketballClubPortals'
import type { Team } from '../../../types'

/**
 * Which placed home games are published to which opponent club, and what the club
 * answered. This is the bridge between the prep grid (where a game is placed) and
 * the portal (where the opponent sees it): a placed game is invisible to the
 * opponent until it is addressed to a club AND offered.
 *
 * A <Table> rather than cards — each row is a record you scan and edit (club,
 * status, answer), which is exactly what CLAUDE.md's "Lists → tables, always" rule
 * covers.
 *
 * Guest games are already filtered out upstream: a guest row is somebody else's
 * game borrowing our hall, and the backend refuses to offer one.
 */

interface Props {
  games: BbOfferRow[]
  clubs: BasketplanClub[]
  teams: Team[]
  isLoading: boolean
  busy: boolean
  assignClub: (gameId: string | number, clubId: number | null) => Promise<void>
  offer: (ids: Array<string | number>, opponentClub?: number | null) => Promise<{ updated: number } | null>
  unoffer: (ids: Array<string | number>) => Promise<{ updated: number } | null>
}

const STATUS_VARIANT: Record<BbProposalStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  draft: 'neutral',
  offered: 'info',
  accepted: 'success',
  declined: 'danger',
  countered: 'warning',
}

export default function BasketballOffersPanel({
  games,
  clubs,
  teams,
  isLoading,
  busy,
  assignClub,
  offer,
  unoffer,
}: Props) {
  const { t } = useTranslation('basketballScheduling')
  const confirm = useConfirm()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)

  const teamName = useMemo(() => {
    const m = new Map<string, string>()
    for (const tm of teams) m.set(String(tm.id), tm.name)
    return m
  }, [teams])

  const opponentClubs = useMemo(
    () => clubs.filter((c) => !c.is_own_club).sort((a, b) => a.name.localeCompare(b.name)),
    [clubs],
  )

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selected = useMemo(() => games.filter((g) => checked.has(String(g.id))), [games, checked])
  const offerable = useMemo(
    () => selected.filter((g) => proposalStatusOf(g) === 'draft' && g.opponent_club != null),
    [selected],
  )
  const withdrawable = useMemo(
    () => selected.filter((g) => proposalStatusOf(g) === 'offered' && !g.responded_at),
    [selected],
  )

  const handleAssign = async (game: BbOfferRow, clubId: number | null) => {
    setSavingId(String(game.id))
    try {
      await assignClub(game.id, clubId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  const handleOffer = async () => {
    if (!offerable.length) return
    if (!(await confirm({ message: t('offerConfirm', { count: offerable.length }) }))) return
    try {
      const res = await offer(offerable.map((g) => g.id))
      toast.success(t('offerDone', { count: res?.updated ?? 0 }))
      setChecked(new Set())
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      toast.error(
        body?.error === 'opponent_club required'
          ? t('offerNeedsClub')
          : body?.error || (err instanceof Error ? err.message : String(err)),
      )
    }
  }

  const handleWithdraw = async () => {
    if (!withdrawable.length) return
    if (!(await confirm({ message: t('unofferConfirm', { count: withdrawable.length }), danger: true }))) return
    try {
      const res = await unoffer(withdrawable.map((g) => g.id))
      toast.success(t('unofferDone', { count: res?.updated ?? 0 }))
      setChecked(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const selectClass =
    'min-h-11 w-full max-w-[16rem] rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('offersTitle')}</h2>
          <p className="mt-1 max-w-3xl text-xs text-gray-500 dark:text-gray-400">{t('offersHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="min-h-11" disabled={busy || offerable.length === 0} onClick={handleOffer}>
            <Send className="h-4 w-4" aria-hidden /> {t('offerSelected', { count: offerable.length })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={busy || withdrawable.length === 0}
            onClick={handleWithdraw}
          >
            <Undo2 className="h-4 w-4" aria-hidden /> {t('unofferSelected', { count: withdrawable.length })}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400">
          <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden />
        </div>
      ) : games.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">{t('offersEmpty')}</p>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"><span className="sr-only">{t('colSelect')}</span></TableHead>
                <TableHead>{t('colDate')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('colHall')}</TableHead>
                <TableHead>{t('colMatch')}</TableHead>
                <TableHead>{t('colOpponentClub')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('colAnswer')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {games.map((g) => {
                const id = String(g.id)
                const status = proposalStatusOf(g)
                const kscw = g.kscw_team != null ? teamName.get(String(g.kscw_team)) : null
                const counters = g.counter_proposals ?? []
                return (
                  <TableRow key={id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label={t('colSelect')}
                        checked={checked.has(id)}
                        onChange={() => toggle(id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-normal break-words tabular-nums">
                      <div className="font-medium">{formatDateZurich(g.date)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{g.time}</div>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words text-xs text-gray-500 sm:table-cell dark:text-gray-400">
                      {g.hall}
                    </TableCell>
                    <TableCell className="whitespace-normal break-words">
                      <div className="font-medium">{kscw || g.kscw_team_label || '—'}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{g.opponent || '—'}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal break-words">
                      <select
                        className={selectClass}
                        value={g.opponent_club != null ? String(g.opponent_club) : ''}
                        disabled={busy || savingId === id || status !== 'draft'}
                        onChange={(e) => handleAssign(g, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">{t('clubUnassigned')}</option>
                        {opponentClubs.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[status]} size="sm">{t(`proposal_${status}`)}</Badge>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words text-xs lg:table-cell">
                      {g.responded_at ? (
                        <div className="space-y-0.5">
                          <div className="text-gray-500 dark:text-gray-400">
                            {g.responded_by_name || ''} · {formatDateZurich(g.responded_at)}
                          </div>
                          {counters.length > 0 && (
                            <div className="text-gray-700 dark:text-gray-300">
                              {t('counterProposals')}:{' '}
                              {counters.map((c) => `${formatDateZurich(c.date)} ${c.time}`).join(', ')}
                            </div>
                          )}
                          {g.opponent_note && <div className="text-gray-500 dark:text-gray-400">“{g.opponent_note}”</div>}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
