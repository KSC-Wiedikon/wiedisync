import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '../../../components/ui/table'
import { formatDateTimeCompact } from '../../../utils/dateHelpers'
import {
  bestOpponentForMessage,
  contactAddressSet,
  downloadMailboxAttachment,
  messagesForOpponent,
  type MailboxAttachment,
  type MailboxMessage,
  type MailboxMessageFull,
  type UseMailboxReturn,
} from '../hooks/useMailbox'
import type { GameSchedulingOpponent } from '../../../types'

const COLLAPSED_COUNT = 10

interface ComposeState {
  to: string
  subject: string
  text: string
  replyToId?: number
}

interface Props {
  mailbox: UseMailboxReturn
  opponents: GameSchedulingOpponent[]
  /** Set from an opponent card's "N emails" button — opens the per-opponent thread dialog. */
  focusOpponent: GameSchedulingOpponent | null
  onClearFocus: () => void
  /** Season label (e.g. "2026/2027") for the auto-generated compose subject. */
  seasonName?: string
  /** Resolves the KSCW team label for an opponent row (matchup subject). */
  kscwTeamLabelFor?: (opp: GameSchedulingOpponent) => string
}

/**
 * Embedded mailbox for the Terminplanung dashboard: the synced
 * volleyball@spielplanung.kscw.ch inbox + sent mail, with reply/compose.
 * Messages are matched to opponents client-side by contact-address overlap.
 */
export default function MailboxPanel({ mailbox, opponents, focusOpponent, onClearFocus, seasonName, kscwTeamLabelFor }: Props) {
  const { t } = useTranslation('gameScheduling')
  const { configured, messages, unread, lastSync, syncing, sending } = mailbox
  const [showAll, setShowAll] = useState(false)
  const [detail, setDetail] = useState<MailboxMessageFull | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [compose, setCompose] = useState<ComposeState | null>(null)

  // Per-opponent contact sets, for the club chip on each row.
  const opponentContacts = useMemo(
    () => opponents.map((o) => ({ opp: o, contacts: contactAddressSet(o) })),
    [opponents],
  )
  const opponentForMessage = (msg: MailboxMessage): GameSchedulingOpponent | null =>
    bestOpponentForMessage(msg, opponentContacts)

  const focusMessages = focusOpponent ? messagesForOpponent(messages, focusOpponent) : []

  const openMessage = async (id: number) => {
    setDetailLoading(true)
    try {
      setDetail(await mailbox.loadMessage(id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDetailLoading(false)
    }
  }

  const handleSync = async () => {
    try {
      await mailbox.sync()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSend = async () => {
    if (!compose) return
    try {
      await mailbox.sendReply({
        to: compose.to,
        subject: compose.subject,
        text: compose.text,
        reply_to_id: compose.replyToId,
      })
      toast.success(t('mailboxSent'))
      setCompose(null)
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      toast.error(body?.error || (err instanceof Error ? err.message : String(err)))
    }
  }

  const replyTo = (msg: MailboxMessageFull) => {
    const to = msg.direction === 'in' ? (msg.from_address || '') : (msg.to_addresses || '')
    const subject = /^re:/i.test(msg.subject || '') ? (msg.subject || '') : `Re: ${msg.subject || ''}`
    setCompose({ to, subject, text: '', replyToId: msg.id })
  }

  const composeForOpponent = (opp: GameSchedulingOpponent) => {
    // Pre-fill the matchup + season, mirroring the invite email subject —
    // also lets the row chip resolve the right team on our outgoing mail.
    const oppLabel = (opp.team_name || opp.club_name || '').trim()
    const kscwLabel = (kscwTeamLabelFor?.(opp) || '').trim()
    const matchup = [oppLabel, kscwLabel].filter(Boolean).join(' – ')
    const subject = [matchup, seasonName ? `Spielplanung ${seasonName}` : '']
      .filter(Boolean)
      .join(' / ')
    setCompose({ to: opp.contact_email || '', subject, text: '' })
  }

  const correspondent = (msg: MailboxMessage) =>
    msg.direction === 'in'
      ? (msg.from_name || msg.from_address || '—')
      : `→ ${(msg.to_addresses || '').split(',')[0] || '—'}`

  const renderRows = (list: MailboxMessage[], showChip: boolean) => (
    <Table>
      <TableBody>
        {list.map((msg) => {
          const isUnread = msg.direction === 'in' && !msg.read_at
          const chipOpp = showChip ? opponentForMessage(msg) : null
          return (
            <TableRow
              key={msg.id}
              onClick={() => void openMessage(msg.id)}
              className="cursor-pointer"
            >
              <TableCell className="whitespace-nowrap align-top text-xs text-gray-500 dark:text-gray-400">
                {msg.date_sent ? formatDateTimeCompact(msg.date_sent) : '—'}
              </TableCell>
              <TableCell className={`hidden max-w-44 truncate align-top sm:table-cell ${isUnread ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
                {correspondent(msg)}
              </TableCell>
              <TableCell className="align-top">
                <div className={`flex flex-wrap items-center gap-1.5 ${isUnread ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                  {isUnread && <span aria-hidden className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-brand-600" />}
                  <span className="break-words">{msg.subject || t('mailboxNoSubject')}</span>
                  {msg.has_attachments && <span aria-hidden title={t('mailboxAttachments')}>📎</span>}
                  {chipOpp && (
                    <Badge variant="neutral" size="sm">{chipOpp.team_name || chipOpp.club_name}</Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-gray-400 sm:hidden dark:text-gray-500">{correspondent(msg)}</div>
                {msg.snippet && (
                  <div className="mt-0.5 hidden truncate text-xs text-gray-400 sm:block dark:text-gray-500">{msg.snippet}</div>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  const visible = showAll ? messages : messages.slice(0, COLLAPSED_COUNT)

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2">
            {t('mailboxTitle')}
            {unread > 0 && <Badge variant="warning" size="sm">{t('mailboxUnread', { count: unread })}</Badge>}
          </CardTitle>
          {configured && (
            <div className="flex items-center gap-2">
              {lastSync && (
                <span className="hidden text-xs text-gray-400 sm:inline dark:text-gray-500">
                  {t('mailboxLastSync', { time: formatDateTimeCompact(lastSync) })}
                </span>
              )}
              <Button size="sm" variant="outline" onClick={() => setCompose({ to: '', subject: '', text: '' })}>
                {t('mailboxCompose')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleSync()} disabled={syncing}>
                {syncing ? t('mailboxChecking') : t('mailboxCheckNow')}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {configured === false ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('mailboxNotConfigured')}</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('mailboxEmpty')}</p>
          ) : (
            <>
              {renderRows(visible, true)}
              {messages.length > COLLAPSED_COUNT && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-2 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  {showAll ? t('mailboxShowLess') : t('mailboxShowAll', { count: messages.length })}
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Per-opponent thread (opened from an opponent card) */}
      <Dialog open={!!focusOpponent} onOpenChange={(o) => { if (!o) onClearFocus() }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{focusOpponent?.team_name || focusOpponent?.club_name}</DialogTitle>
            <DialogDescription className="break-words">{focusOpponent?.contact_email}</DialogDescription>
          </DialogHeader>
          {configured === false ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('mailboxNotConfigured')}</p>
          ) : (
            <>
              <div className="max-h-[50vh] overflow-y-auto">
                {focusMessages.length === 0
                  ? <p className="text-sm text-gray-500 dark:text-gray-400">{t('mailboxEmpty')}</p>
                  : renderRows(focusMessages, false)}
              </div>
              <div>
                <Button size="sm" onClick={() => focusOpponent && composeForOpponent(focusOpponent)}>
                  {t('mailboxCompose')}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Message detail */}
      <Dialog open={!!detail || detailLoading} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="sm:max-w-3xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="break-words pr-6">{detail.subject || t('mailboxNoSubject')}</DialogTitle>
                <DialogDescription className="break-words">
                  {t('mailboxFrom')}: {detail.from_name ? `${detail.from_name} <${detail.from_address}>` : detail.from_address}
                  {' · '}{t('mailboxTo')}: {detail.to_addresses}
                  {detail.date_sent ? ` · ${formatDateTimeCompact(detail.date_sent)}` : ''}
                </DialogDescription>
              </DialogHeader>
              {detail.body_html ? (
                /* Sandboxed so the email HTML can't touch the app DOM. */
                <iframe
                  title={detail.subject || t('mailboxNoSubject')}
                  srcDoc={detail.body_html}
                  sandbox=""
                  className="h-96 w-full rounded-md border border-gray-200 bg-white dark:border-gray-700"
                />
              ) : (
                <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  {detail.body_text || ''}
                </div>
              )}
              <MailboxAttachments message={detail} />
              <div>
                <Button size="sm" onClick={() => replyTo(detail)}>{t('mailboxReply')}</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Compose / reply */}
      <Dialog open={!!compose} onOpenChange={(o) => { if (!o) setCompose(null) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{compose?.replyToId ? t('mailboxReply') : t('mailboxCompose')}</DialogTitle>
            <DialogDescription className="sr-only">{t('mailboxCompose')}</DialogDescription>
          </DialogHeader>
          {compose && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxTo')}</label>
                <input
                  type="text"
                  value={compose.to}
                  onChange={(e) => setCompose({ ...compose, to: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxSubject')}</label>
                <input
                  type="text"
                  value={compose.subject}
                  onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
                  maxLength={300}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxBody')}</label>
                <textarea
                  value={compose.text}
                  onChange={(e) => setCompose({ ...compose, text: e.target.value })}
                  rows={8}
                  maxLength={50000}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setCompose(null)}>{t('cancel')}</Button>
                <Button
                  size="sm"
                  onClick={() => void handleSend()}
                  disabled={sending || !compose.to.trim() || !compose.subject.trim() || !compose.text.trim()}
                >
                  {sending ? t('mailboxSending') : t('mailboxSend')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function MailboxAttachments({ message }: { message: MailboxMessageFull }) {
  const { t } = useTranslation('gameScheduling')
  const attachments: MailboxAttachment[] = useMemo(() => {
    const raw = message.attachments
    if (!raw) return []
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) as MailboxAttachment[] } catch { return [] }
    }
    return raw
  }, [message.attachments])
  const [downloading, setDownloading] = useState<number | null>(null)

  if (attachments.length === 0) return null

  const download = async (index: number, filename: string) => {
    setDownloading(index)
    try {
      await downloadMailboxAttachment(message.id, index, filename)
    } catch {
      toast.error(t('mailboxDownloadFailed'))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxAttachments')}:</span>
      {attachments.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => void download(i, a.filename)}
          disabled={downloading !== null}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {downloading === i ? '…' : `📎 ${a.filename}`}
        </button>
      ))}
    </div>
  )
}
