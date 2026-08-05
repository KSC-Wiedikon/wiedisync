import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Link2, Loader2, Mail, RotateCcw, Search, Ban, Pencil } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { useConfirm } from '../../../components/ConfirmProvider'
import { formatDateZurich } from '../../../utils/dateHelpers'
import BasketballSendPortalModal from './BasketballSendPortalModal'
import type {
  BasketplanClub,
  BbClubPortal,
  BbPortalStatus,
  BbSendOptions,
  BbSendResult,
} from '../hooks/useBasketballClubPortals'

/**
 * Opponent clubs and their portal links (basketball).
 *
 * ONE link per opponent CLUB — not per team — because that is how ProBasket clubs
 * are organised: a single "Spielplanverantwortliche Person" answers for every team
 * of the club. The link opens the public page at /terminplanung/bb/<token>, which
 * lists the KSCW home games placed against that club and lets them confirm,
 * decline or counter-propose before the Spielplansitzung.
 *
 * Two states are NORMAL here and must not read as errors:
 *  · a club with no contact email — the registry ships names only (63 clubs seeded
 *    from the ProBasket workbook, contacts are filled in by hand or by a scrape);
 *  · a club with no link — links are only minted for clubs we actually play.
 *
 * Sending never happens from this panel directly: the button opens a preview
 * dialog, and only its footer button sends.
 */

interface Props {
  clubs: BasketplanClub[]
  portals: BbClubPortal[]
  portalByClub: Map<string, BbClubPortal>
  isLoading: boolean
  busy: boolean
  /** True when the endpoints answered with an error (e.g. not deployed yet). */
  hasError: boolean
  ensure: (clubIds?: Array<string | number>) => Promise<unknown>
  reissue: (portalId: number) => Promise<unknown>
  revoke: (portalId: number) => Promise<unknown>
  send: (opts: BbSendOptions) => Promise<BbSendResult | null>
  saveClubContact: (clubId: number, patch: Partial<BasketplanClub>) => Promise<void>
  /** basketplan_clubs.id → how many placed games are addressed to it (any status). */
  gamesByClub: Map<string, number>
}

const STATUS_VARIANT: Record<BbPortalStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  invited: 'neutral',
  viewed: 'warning',
  booked: 'success',
  revoked: 'danger',
  expired: 'danger',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function BasketballClubPortalsPanel({
  clubs,
  portals,
  portalByClub,
  isLoading,
  busy,
  hasError,
  ensure,
  reissue,
  revoke,
  send,
  saveClubContact,
  gamesByClub,
}: Props) {
  const { t } = useTranslation('basketballScheduling')
  const confirm = useConfirm()

  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [sendIds, setSendIds] = useState<number[] | null>(null)
  const [editClub, setEditClub] = useState<BasketplanClub | null>(null)

  /** Opponent clubs only — we never mint a portal for ourselves. */
  const opponents = useMemo(() => clubs.filter((c) => !c.is_own_club), [clubs])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return opponents
      .map((club) => ({
        club,
        portal: portalByClub.get(String(club.id)) ?? null,
        games: gamesByClub.get(String(club.id)) ?? 0,
      }))
      .filter((r) => (showAll ? true : !!r.portal || r.games > 0))
      .filter((r) => (q ? r.club.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.club.name.localeCompare(b.club.name))
  }, [opponents, portalByClub, gamesByClub, showAll, query])

  const relevantCount = useMemo(
    () => opponents.filter((c) => portalByClub.has(String(c.id)) || (gamesByClub.get(String(c.id)) ?? 0) > 0).length,
    [opponents, portalByClub, gamesByClub],
  )
  const withoutContact = useMemo(
    () => rows.filter((r) => !(r.club.contact_email || '').trim()).length,
    [rows],
  )

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('portalLinkCopied'))
    } catch {
      toast.error(t('portalLinkCopyFailed'))
    }
  }

  const handleEnsure = async (clubIds?: Array<string | number>) => {
    try {
      await ensure(clubIds)
      toast.success(t('portalLinksRefreshed'))
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      toast.error(body?.error || (err instanceof Error ? err.message : String(err)))
    }
  }

  const handleReissue = async (portal: BbClubPortal) => {
    if (!(await confirm({ message: t('portalReissueConfirm', { club: portal.club_name || '' }), danger: true }))) return
    try {
      await reissue(portal.id)
      toast.success(t('portalReissued'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRevoke = async (portal: BbClubPortal) => {
    if (!(await confirm({ message: t('portalRevokeConfirm', { club: portal.club_name || '' }), danger: true }))) return
    try {
      await revoke(portal.id)
      toast.success(t('portalRevoked'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const sendablePortals = useMemo(
    () => portals.filter((p) => p.status !== 'revoked' && p.status !== 'expired' && (p.contact_email || '').trim() && p.offers.total > 0),
    [portals],
  )

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('opponentClubs')}</h2>
          <p className="mt-1 max-w-3xl text-xs text-gray-500 dark:text-gray-400">{t('opponentClubsHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => handleEnsure()}>
            <Link2 className="h-4 w-4" aria-hidden /> {t('portalEnsureAll')}
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            disabled={busy || sendablePortals.length === 0}
            onClick={() => setSendIds(sendablePortals.map((p) => p.id))}
          >
            <Mail className="h-4 w-4" aria-hidden /> {t('portalSendAll', { count: sendablePortals.length })}
          </Button>
        </div>
      </div>

      {hasError && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          {t('portalBackendUnavailable')}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('opponentClubsSearch')}
            aria-label={t('opponentClubsSearch')}
            className="min-h-11 w-full rounded-md border border-gray-300 bg-white pl-8 pr-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        </label>
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => setShowAll((v) => !v)}>
          {showAll ? t('opponentClubsShowRelevant', { count: relevantCount }) : t('opponentClubsShowAll', { count: opponents.length })}
        </Button>
      </div>

      {withoutContact > 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{t('opponentClubsNoContactHint', { count: withoutContact })}</p>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400">
          <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">{t('opponentClubsEmpty')}</p>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colClub')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('colContact')}</TableHead>
                <TableHead>{t('colGames')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('colLink')}</TableHead>
                <TableHead className="text-right">{t('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ club, portal, games }) => {
                const email = (club.contact_email || '').trim()
                const secondary = (club.contact_email_secondary || '').trim()
                return (
                  <TableRow key={club.id}>
                    <TableCell className="whitespace-normal break-words font-medium">
                      {club.name}
                      {!email && (
                        <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {t('portalNoContact')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words text-xs text-gray-500 sm:table-cell dark:text-gray-400">
                      {email ? (
                        <>
                          {club.contact_name && <div className="text-gray-700 dark:text-gray-300">{club.contact_name}</div>}
                          <div>{email}</div>
                          {secondary && <div>{secondary}</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {portal ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <span className="font-semibold">{portal.offers.total}</span>
                          {portal.offers.accepted > 0 && (
                            <Badge variant="success" size="sm">{t('offerAcceptedShort', { count: portal.offers.accepted })}</Badge>
                          )}
                          {portal.offers.countered > 0 && (
                            <Badge variant="warning" size="sm">{t('offerCounteredShort', { count: portal.offers.countered })}</Badge>
                          )}
                          {portal.offers.declined > 0 && (
                            <Badge variant="danger" size="sm">{t('offerDeclinedShort', { count: portal.offers.declined })}</Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">{games || 0}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words md:table-cell">
                      {portal ? (
                        <span className="flex flex-col gap-1">
                          <Badge variant={STATUS_VARIANT[portal.status] || 'neutral'} size="sm">
                            {t(`portalStatus_${portal.status}`)}
                          </Badge>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            {portal.email_sent_at
                              ? t('portalSentOn', { date: formatDateZurich(portal.email_sent_at) })
                              : t('portalNotSentYet')}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{t('portalNoLinkYet')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-stretch justify-end gap-1 sm:flex-row sm:items-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-11 sm:min-h-0"
                          onClick={() => setEditClub(club)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden /> {t('editContact')}
                        </Button>
                        {portal ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-11 sm:min-h-0"
                              onClick={() => copyLink(portal.url)}
                            >
                              <Copy className="h-4 w-4" aria-hidden /> {t('portalCopyLink')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-11 sm:min-h-0"
                              disabled={busy || !email || portal.status === 'revoked'}
                              onClick={() => setSendIds([portal.id])}
                            >
                              <Mail className="h-4 w-4" aria-hidden /> {t('portalSend')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-11 sm:min-h-0"
                              disabled={busy}
                              onClick={() => handleReissue(portal)}
                            >
                              <RotateCcw className="h-4 w-4" aria-hidden /> {t('portalReissue')}
                            </Button>
                            {portal.status !== 'revoked' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="min-h-11 text-rose-600 sm:min-h-0"
                                disabled={busy}
                                onClick={() => handleRevoke(portal)}
                              >
                                <Ban className="h-4 w-4" aria-hidden /> {t('portalRevoke')}
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-11 sm:min-h-0"
                            disabled={busy}
                            onClick={() => handleEnsure([club.id])}
                          >
                            <Link2 className="h-4 w-4" aria-hidden /> {t('portalIssueLink')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {sendIds !== null && (
        <BasketballSendPortalModal
          open
          onOpenChange={(o) => {
            if (!o) setSendIds(null)
          }}
          ids={sendIds}
          send={send}
        />
      )}

      <ClubContactDialog
        club={editClub}
        onClose={() => setEditClub(null)}
        onSave={saveClubContact}
      />
    </div>
  )
}

/** Inline editor for a club's ProBasket scheduling contact. */
function ClubContactDialog({
  club,
  onClose,
  onSave,
}: {
  club: BasketplanClub | null
  onClose: () => void
  onSave: (clubId: number, patch: Partial<BasketplanClub>) => Promise<void>
}) {
  const { t } = useTranslation('basketballScheduling')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', email2: '', phone: '', role: '' })

  // Re-seed the form whenever a different club is opened — settled during render so
  // the dialog never flashes the previous club's contact.
  const [prevClubId, setPrevClubId] = useState<number | null>(club?.id ?? null)
  if (prevClubId !== (club?.id ?? null)) {
    setPrevClubId(club?.id ?? null)
    setError('')
    setForm({
      name: club?.contact_name || '',
      email: club?.contact_email || '',
      email2: club?.contact_email_secondary || '',
      phone: club?.contact_phone || '',
      role: club?.contact_role_label || '',
    })
  }

  const inputClass =
    'min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

  const handleSave = async () => {
    if (!club) return
    const email = form.email.trim()
    const email2 = form.email2.trim()
    if (email && !EMAIL_RE.test(email)) {
      setError(t('portalContactInvalidEmail'))
      return
    }
    if (email2 && !EMAIL_RE.test(email2)) {
      setError(t('portalContactInvalidEmail'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(club.id, {
        contact_name: form.name.trim() || null,
        contact_email: email || null,
        contact_email_secondary: email2 || null,
        contact_phone: form.phone.trim() || null,
        contact_role_label: form.role.trim() || null,
      })
      toast.success(t('portalContactSaved'))
      onClose()
    } catch (err) {
      const body = (err as { body?: { errors?: Array<{ message?: string }> } })?.body
      setError(body?.errors?.[0]?.message || (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={club !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('portalContactTitle', { club: club?.name || '' })}</DialogTitle>
          <DialogDescription>{t('portalContactHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('portalContactName')}
            <input className={`mt-1 ${inputClass}`} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('portalContactEmail')}
            <input type="email" className={`mt-1 ${inputClass}`} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('portalContactEmail2')}
            <input type="email" className={`mt-1 ${inputClass}`} value={form.email2} onChange={(e) => setForm((f) => ({ ...f, email2: e.target.value }))} />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('portalContactPhone')}
            <input className={`mt-1 ${inputClass}`} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </label>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t('portalContactRole')}
            <input className={`mt-1 ${inputClass}`} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} />
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? t('saving') : t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
