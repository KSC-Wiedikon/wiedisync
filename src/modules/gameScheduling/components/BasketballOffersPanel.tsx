import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Check, Handshake, Loader2, Send, Trash2, Undo2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { useConfirm } from '../../../components/ConfirmProvider'
import Modal from '../../../components/Modal'
import { formatDateZurich } from '../../../utils/dateHelpers'
import {
  MARK_AGREED_FRESH_STATUSES,
  MARK_AGREED_OVERRIDE_STATUSES,
  proposalStatusOf,
  type BbOfferRow,
  type BbProposalStatus,
} from '../hooks/useBasketballOffers'
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
  answerClubProposal: (
    ids: Array<string | number>,
    decision: 'accept' | 'release',
  ) => Promise<{ affected: number } | null>
  markAgreed: (
    ids: Array<string | number>,
    opts: { agreedWith: string; note?: string; override?: boolean },
  ) => Promise<{
    updated: number
    already_agreed: number[]
    skipped: Array<{ id: number; reason: string }>
  } | null>
}

const STATUS_VARIANT: Record<BbProposalStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  draft: 'neutral',
  offered: 'info',
  // The one status that is waiting on US, so it reads as an action, not an outcome.
  club_proposed: 'warning',
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
  answerClubProposal,
  markAgreed,
}: Props) {
  const { t } = useTranslation('basketballScheduling')
  const confirm = useConfirm()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)

  // "Mark as agreed" modal. Kept as one object so closing it can never leave a
  // half-filled form (a stale override tick above all) behind for the next batch.
  const [agreeOpen, setAgreeOpen] = useState(false)
  const [agreeWith, setAgreeWith] = useState('')
  const [agreeNote, setAgreeNote] = useState('')
  const [agreeOverride, setAgreeOverride] = useState(false)
  const [agreeSubmitting, setAgreeSubmitting] = useState(false)

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
  /** Dates a club picked itself — the only rows a planner answers with accept/release. */
  const clubProposed = useMemo(
    () => selected.filter((g) => proposalStatusOf(g) === 'club_proposed'),
    [selected],
  )
  const pendingClubPicks = useMemo(
    () => games.filter((g) => proposalStatusOf(g) === 'club_proposed').length,
    [games],
  )

  // ── "Agreed on the phone" selection ───────────────────────────────────────
  // Split three ways rather than one flat list, because the three need different
  // things said about them: `fresh` just records, `overwrite` destroys an answer a
  // third party gave us and must be ticked for explicitly, and `already` is a no-op
  // worth naming so a re-submitted selection does not look like it failed.
  const agreeFresh = useMemo(
    () => selected.filter(
      (g) => g.opponent_club != null && MARK_AGREED_FRESH_STATUSES.includes(proposalStatusOf(g)),
    ),
    [selected],
  )
  const agreeOverwrite = useMemo(
    () => selected.filter(
      (g) => g.opponent_club != null && MARK_AGREED_OVERRIDE_STATUSES.includes(proposalStatusOf(g)),
    ),
    [selected],
  )
  const agreeAlready = useMemo(
    () => selected.filter((g) => proposalStatusOf(g) === 'accepted'),
    [selected],
  )
  const agreeTargets = useMemo(() => [...agreeFresh, ...agreeOverwrite], [agreeFresh, agreeOverwrite])
  /** Selected rows that cannot be agreed and why — shown in the modal, never silently dropped. */
  const agreeBlocked = useMemo(
    () => selected.filter((g) => g.opponent_club == null || proposalStatusOf(g) === 'club_proposed'),
    [selected],
  )
  /**
   * One phone call is with ONE club. Recording a single contact's name against games
   * belonging to two different clubs would put words in somebody's mouth, so the modal
   * refuses the batch instead of asking the planner to notice.
   */
  const agreeClubIds = useMemo(
    () => [...new Set(agreeTargets.map((g) => String(g.opponent_club)))],
    [agreeTargets],
  )
  const agreeClub = useMemo(
    () => (agreeClubIds.length === 1 ? opponentClubs.find((c) => String(c.id) === agreeClubIds[0]) ?? null : null),
    [agreeClubIds, opponentClubs],
  )
  const agreeMultiClub = agreeClubIds.length > 1
  const agreeCanSubmit =
    agreeTargets.length > 0
    && !agreeMultiClub
    && agreeWith.trim().length > 0
    && (agreeOverwrite.length === 0 || agreeOverride)

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

  const handleAcceptPicks = async () => {
    if (!clubProposed.length) return
    try {
      const res = await answerClubProposal(clubProposed.map((g) => g.id), 'accept')
      toast.success(t('clubPicksAccepted', { count: res?.affected ?? 0 }))
      setChecked(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleReleasePicks = async () => {
    if (!clubProposed.length) return
    // Destructive and irreversible: releasing DELETES the row, which is the only way the
    // pitch goes back on every club's free list. Say that plainly before doing it.
    if (!(await confirm({ message: t('clubPicksReleaseConfirm', { count: clubProposed.length }), danger: true }))) return
    try {
      const res = await answerClubProposal(clubProposed.map((g) => g.id), 'release')
      toast.success(t('clubPicksReleased', { count: res?.affected ?? 0 }))
      setChecked(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const openAgree = () => {
    // Seed the contact from the club registry — the person we already have on file is
    // almost always who answered the phone. Still editable, and still required.
    setAgreeWith(agreeClub?.contact_name?.trim() || '')
    setAgreeNote('')
    setAgreeOverride(false)
    setAgreeOpen(true)
  }

  const closeAgree = () => {
    if (agreeSubmitting) return
    setAgreeOpen(false)
  }

  const handleMarkAgreed = async () => {
    if (!agreeCanSubmit || agreeSubmitting) return
    setAgreeSubmitting(true)
    try {
      const res = await markAgreed(agreeTargets.map((g) => g.id), {
        agreedWith: agreeWith.trim(),
        note: agreeNote.trim() || undefined,
        override: agreeOverwrite.length > 0 ? true : undefined,
      })
      toast.success(t('agreedDone', { count: res?.updated ?? 0 }))
      // A row the club answered while this modal was open is NOT an error and NOT a
      // success — say so plainly, because the planner's next move differs either way.
      if (res?.skipped?.length) toast.warning(t('agreedSkipped', { count: res.skipped.length }))
      setAgreeOpen(false)
      setChecked(new Set())
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      const map: Record<string, string> = {
        'opponent_club required': t('offerNeedsClub'),
        use_club_picks: t('agreedUseClubPicks'),
        would_overwrite_club_answer: t('agreedOverwriteRefused'),
        guest_game_not_offerable: t('agreedGuestGame'),
        agreed_with_required: t('agreedWithRequired'),
      }
      toast.error(
        (body?.error && map[body.error])
          || body?.error
          || (err instanceof Error ? err.message : String(err)),
      )
    } finally {
      setAgreeSubmitting(false)
    }
  }

  const selectClass =
    'min-h-11 w-full max-w-[16rem] rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
  const inputClass =
    'min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'

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
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={busy || agreeTargets.length === 0}
            onClick={openAgree}
          >
            <Handshake className="h-4 w-4" aria-hidden /> {t('agreedSelected', { count: agreeTargets.length })}
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            disabled={busy || clubProposed.length === 0}
            onClick={handleAcceptPicks}
          >
            <Check className="h-4 w-4" aria-hidden /> {t('clubPicksAccept', { count: clubProposed.length })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 text-rose-600"
            disabled={busy || clubProposed.length === 0}
            onClick={handleReleasePicks}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> {t('clubPicksRelease', { count: clubProposed.length })}
          </Button>
        </div>
      </div>

      {/* The one state waiting on us — easy to miss in a long table, so name it up front. */}
      {pendingClubPicks > 0 && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          {t('clubPicksPending', { count: pendingClubPicks })}
        </p>
      )}

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
                      {/* An agreement WE wrote down and one the club gave through its link are
                          both 'accepted' in the database, and they are not the same evidence.
                          The badge says which. */}
                      <Badge variant={STATUS_VARIANT[status]} size="sm">
                        {status === 'accepted' && g.agreed_offline
                          ? t('proposal_agreed_offline')
                          : t(`proposal_${status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words text-xs lg:table-cell">
                      {g.responded_at ? (
                        <div className="space-y-0.5">
                          <div className="text-gray-500 dark:text-gray-400">
                            {g.responded_by_name || ''} · {formatDateZurich(g.responded_at)}
                          </div>
                          {g.agreed_offline && (
                            <div className="text-gray-500 dark:text-gray-400">
                              {t('agreedRecordedBy', { name: g.agreed_offline_by_name || '—' })}
                            </div>
                          )}
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

      {/* ── Mark as agreed ─────────────────────────────────────────────────────
          Everything the planner is about to assert is on screen before they can
          assert it: which games, with which club, in whose name. The one input is
          required because the row it fills is the evidence we would show ProBasket
          — "agreed with nobody" is a note to self, not an agreement. */}
      <Modal open={agreeOpen} onClose={closeAgree} title={t('agreedTitle')} size="lg">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('agreedHint')}</p>

          {agreeMultiClub ? (
            // Hard stop, not a warning: one name cannot speak for two clubs.
            <p className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200">
              {t('agreedOneClubOnly', { count: agreeClubIds.length })}
            </p>
          ) : (
            <>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {t('agreedGamesHeading', { count: agreeTargets.length, club: agreeClub?.name ?? '—' })}
                </h3>
                <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-200">
                  {agreeTargets.map((g) => (
                    <li key={String(g.id)} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="tabular-nums font-medium">{formatDateZurich(g.date)} {g.time}</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {(g.kscw_team != null ? teamName.get(String(g.kscw_team)) : null) || g.kscw_team_label || '—'}
                        {' – '}
                        {g.opponent || '—'}
                      </span>
                      <Badge variant={STATUS_VARIANT[proposalStatusOf(g)]} size="sm">
                        {t(`proposal_${proposalStatusOf(g)}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Rows the club already answered. Loud, itemised, and gated behind a tick
                  the planner has to find — replacing a third party's answer is not
                  something to do by momentum. */}
              {agreeOverwrite.length > 0 && (
                <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 dark:border-rose-800 dark:bg-rose-900/20">
                  <p className="flex items-start gap-2 text-sm font-medium text-rose-900 dark:text-rose-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {t('agreedOverwriteWarning', { count: agreeOverwrite.length })}
                  </p>
                  <ul className="mt-1.5 space-y-0.5 pl-6 text-xs text-rose-900 dark:text-rose-200">
                    {agreeOverwrite.map((g) => (
                      <li key={String(g.id)}>
                        {formatDateZurich(g.date)} — {t(`proposal_${proposalStatusOf(g)}`)}
                        {g.opponent_note ? ` — “${g.opponent_note}”` : ''}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-start gap-2 text-sm text-rose-900 dark:text-rose-200">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={agreeOverride}
                      onChange={(e) => setAgreeOverride(e.target.checked)}
                    />
                    <span>{t('agreedOverwriteConfirm')}</span>
                  </label>
                </div>
              )}

              {/* Selected rows that cannot be agreed at all. Named rather than dropped:
                  a silently shorter batch is how a planner comes to believe a game is
                  settled when it is not. */}
              {agreeBlocked.length > 0 && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                  {t('agreedBlocked', { count: agreeBlocked.length })}
                </p>
              )}
              {agreeAlready.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('agreedAlready', { count: agreeAlready.length })}
                </p>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="bb-agreed-with">
                  {t('agreedWithLabel')}
                </label>
                <input
                  id="bb-agreed-with"
                  className={inputClass}
                  value={agreeWith}
                  maxLength={120}
                  onChange={(e) => setAgreeWith(e.target.value)}
                  placeholder={t('agreedWithPlaceholder')}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('agreedWithHint')}</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="bb-agreed-note">
                  {t('agreedNoteLabel')}
                </label>
                <textarea
                  id="bb-agreed-note"
                  className={`${inputClass} min-h-[4.5rem]`}
                  value={agreeNote}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setAgreeNote(e.target.value)}
                  placeholder={t('agreedNotePlaceholder')}
                />
              </div>
            </>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="min-h-11" onClick={closeAgree} disabled={agreeSubmitting}>
              {t('cancel')}
            </Button>
            <Button className="min-h-11" onClick={handleMarkAgreed} disabled={!agreeCanSubmit || agreeSubmitting}>
              {agreeSubmitting
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                : <Handshake className="h-4 w-4" aria-hidden />}
              {t('agreedSubmit', { count: agreeTargets.length })}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
