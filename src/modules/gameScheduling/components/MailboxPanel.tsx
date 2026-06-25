import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Paperclip, X } from 'lucide-react'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '../../../components/ui/table'
import RichTextEditor from '../../../components/RichTextEditor'
import InlineSpinner from '../../../components/InlineSpinner'
import { formatDateTimeCompact } from '../../../utils/dateHelpers'
import {
  chipOpponentForMessage,
  classifyMessages,
  downloadMailboxAttachment,
  messagesForOwner,
  threadIdsForMessage,
  type MailboxAttachment,
  type MailboxMessage,
  type MailboxMessageFull,
  type MailboxSport,
  type MessageClassification,
  type OpponentContacts,
  type UseMailboxReturn,
} from '../hooks/useMailbox'
import type { GameSchedulingOpponent } from '../../../types'

const COLLAPSED_COUNT = 10

/** Compose modes — new mail, reply, reply-all, or forward. */
type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

/** Inbox = received (direction in), Sent = sent (direction out). */
type Folder = 'inbox' | 'sent'

// Outgoing-attachment caps (mirrored server-side in scheduling-mailbox.js).
const ATTACH_MAX_FILES = 10
const ATTACH_MAX_TOTAL = 10 * 1024 * 1024 // 10 MB total

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Wrap a received email's HTML in a minimal document that pins a light colour
 * scheme (white background, dark text). Emails carry their own colours and the
 * sandboxed iframe otherwise inherits the app's dark canvas — dark-on-dark mail
 * was unreadable. Like every mail client, we render messages on white in both
 * app themes. `base target=_blank` keeps any links opening in a new tab.
 */
function emailSrcDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<base target="_blank">` +
    `<style>:root{color-scheme:light}` +
    `html,body{margin:0;padding:12px;background:#ffffff;color:#111827;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:14px;line-height:1.5;overflow-wrap:break-word}` +
    `a{color:#3D4A99}img{max-width:100%;height:auto}` +
    `blockquote{margin:0 0 0 12px;padding-left:12px;border-left:3px solid #e5e7eb;color:#4b5563}` +
    `</style></head><body>${html}</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Count of attachments on a full message (the column is jsonb or a string). */
function attachmentCount(msg: MailboxMessageFull): number {
  const raw = msg.attachments
  if (!raw) return 0
  if (typeof raw === 'string') { try { return (JSON.parse(raw) as unknown[]).length } catch { return 0 } }
  return Array.isArray(raw) ? raw.length : 0
}

interface ComposeState {
  to: string
  /** Carbon-copy recipients (comma-separated). Populated for reply-all. */
  cc: string
  subject: string
  /** Rich-text HTML from the TipTap editor (empty string when blank). */
  html: string
  attachments: File[]
  replyToId?: number
  /** Forward: source message id whose attachments the server re-attaches. */
  forwardFromId?: number
  /** Count of attachments carried over from the forwarded message (UI hint). */
  forwardAttachCount?: number
  mode: ComposeMode
}

interface Props {
  mailbox: UseMailboxReturn
  /** Which mailbox account this panel is showing — passed through to attachment
   *  downloads so they hit the right account. */
  sport?: MailboxSport
  /** All opponents + their contact sets (and KSCW-pairing aliases), built once
   *  by the page so the chip and the per-opponent thread disambiguate
   *  identically across opponent rows that share a club's contacts. Empty for
   *  basketball (no opponent scheduling) → no chips/assign/thread. */
  opponentContacts: OpponentContacts[]
  /** Set from an opponent card's "N emails" deep-link — opens the per-opponent thread dialog. */
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
export default function MailboxPanel({ mailbox, sport = 'volleyball', opponentContacts, focusOpponent, onClearFocus, seasonName, kscwTeamLabelFor }: Props) {
  const { t } = useTranslation('gameScheduling')
  const { configured, messages, unread, lastSync, syncing, sending } = mailbox
  const [showAll, setShowAll] = useState(false)
  const [folder, setFolder] = useState<Folder>('inbox')
  const [search, setSearch] = useState('')
  // Server-side search results (subject + sender/recipient + body). null = not
  // searching → show the cached list. The cached `messages` is never replaced,
  // so the opponent thread/chip features keep reading the full list.
  const [results, setResults] = useState<MailboxMessage[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeq = useRef(0)
  const [detail, setDetail] = useState<MailboxMessageFull | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [compose, setCompose] = useState<ComposeState | null>(null)

  // Classify the whole list once: contact match + KSCW team code / opponent
  // name, with thread inheritance for forwarded/stripped replies. Drives both
  // the row chip and the per-opponent thread so they always agree.
  const classification = useMemo(() => classifyMessages(messages, opponentContacts), [messages, opponentContacts])

  const opponentForMessage = (msg: MailboxMessage): GameSchedulingOpponent | null =>
    chipOpponentForMessage(classification.get(msg.id), opponentContacts)

  const focusMessages = focusOpponent ? messagesForOwner(messages, focusOpponent.id, classification) : []

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

  // Debounced server-side search. Runs in the change handler (not an effect) so
  // it stays a plain event handler. A seq guard drops stale/late responses.
  const onSearchChange = (value: string) => {
    setSearch(value)
    const q = value.trim()
    if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null }
    if (q.length < 2) { searchSeq.current++; setResults(null); setSearching(false); return }
    setSearching(true)
    const seq = ++searchSeq.current
    searchTimer.current = setTimeout(() => {
      mailbox.searchMessages(q)
        .then((r) => { if (seq === searchSeq.current) setResults(r) })
        .catch(() => { if (seq === searchSeq.current) setResults([]) })
        .finally(() => { if (seq === searchSeq.current) setSearching(false) })
    }, 300)
  }

  const handleSend = async () => {
    if (!compose) return
    try {
      await mailbox.sendReply({
        to: compose.to,
        cc: compose.cc || undefined,
        subject: compose.subject,
        html: compose.html,
        reply_to_id: compose.replyToId,
        forward_from_id: compose.forwardFromId,
        attachments: compose.attachments,
      })
      toast.success(t('mailboxSent'))
      setCompose(null)
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      toast.error(body?.error || (err instanceof Error ? err.message : String(err)))
    }
  }

  // Merge newly picked files into the compose state, deduping by name+size and
  // enforcing the count + total-size caps (also enforced server-side).
  const addAttachments = (files: FileList | null) => {
    if (!compose || !files || files.length === 0) return
    const merged = [...compose.attachments]
    for (const f of Array.from(files)) {
      if (!merged.some((m) => m.name === f.name && m.size === f.size)) merged.push(f)
    }
    if (merged.length > ATTACH_MAX_FILES) {
      toast.error(t('mailboxAttachTooMany', { count: ATTACH_MAX_FILES }))
      return
    }
    if (merged.reduce((s, f) => s + f.size, 0) > ATTACH_MAX_TOTAL) {
      toast.error(t('mailboxAttachTooLarge', { size: formatBytes(ATTACH_MAX_TOTAL) }))
      return
    }
    setCompose({ ...compose, attachments: merged })
  }

  const removeAttachment = (idx: number) => {
    if (!compose) return
    setCompose({ ...compose, attachments: compose.attachments.filter((_, i) => i !== idx) })
  }

  // Our own mailbox address for this account — kept out of reply-all recipients
  // (the server also strips it, but the compose form shouldn't show it either).
  const selfAddress = (sport === 'basketball' ? 'basketball@spielplanung.kscw.ch' : 'volleyball@spielplanung.kscw.ch')

  const splitAddrs = (s: string | null | undefined) =>
    String(s || '').split(',').map((a) => a.trim()).filter(Boolean)

  // Reply (all=false) or Reply-all (all=true). To = the other party; for
  // reply-all every other To/Cc address (minus us + the primary) becomes Cc.
  const startReply = (msg: MailboxMessageFull, all: boolean) => {
    const isIn = msg.direction === 'in'
    const primary = isIn ? (msg.from_address || '') : (splitAddrs(msg.to_addresses)[0] || '')
    let ccList: string[] = []
    if (all) {
      const everyone = [...splitAddrs(msg.to_addresses), ...splitAddrs(msg.cc_addresses)]
      ccList = [...new Set(everyone.filter((a) => {
        const low = a.toLowerCase()
        return low !== selfAddress && low !== primary.toLowerCase()
      }))]
    }
    const subject = /^re:/i.test(msg.subject || '') ? (msg.subject || '') : `Re: ${msg.subject || ''}`
    setCompose({ to: primary, cc: ccList.join(', '), subject, html: '', attachments: [], replyToId: msg.id, mode: all ? 'replyAll' : 'reply' })
  }

  // Minimal quoted block for a forward: a header + the original plain body
  // (kept plain so it pastes cleanly into the rich-text editor and stays
  // editable; the attachments ride along server-side via forward_from_id).
  const buildForwardQuote = (msg: MailboxMessageFull): string => {
    const when = msg.date_sent ? formatDateTimeCompact(msg.date_sent) : ''
    const fromLine = msg.from_name
      ? `${escapeHtml(msg.from_name)} &lt;${escapeHtml(msg.from_address || '')}&gt;`
      : escapeHtml(msg.from_address || '')
    const header =
      `<p>---------- ${escapeHtml(t('mailboxForwardedMessage'))} ----------<br>` +
      `${escapeHtml(t('mailboxFrom'))}: ${fromLine}<br>` +
      `${escapeHtml(t('mailboxDate'))}: ${escapeHtml(when)}<br>` +
      `${escapeHtml(t('mailboxSubject'))}: ${escapeHtml(msg.subject || '')}<br>` +
      `${escapeHtml(t('mailboxTo'))}: ${escapeHtml(msg.to_addresses || '')}</p>`
    const body = `<p>${escapeHtml(msg.body_text || '').replace(/\n/g, '<br>')}</p>`
    return header + body
  }

  // Forward: new thread (no reply_to), quoted original body, and the server
  // re-attaches the source's files (forward_from_id) so they ride along.
  const startForward = (msg: MailboxMessageFull) => {
    const subject = /^fwd?:/i.test(msg.subject || '') ? (msg.subject || '') : `Fwd: ${msg.subject || ''}`
    setCompose({
      to: '', cc: '', subject, html: buildForwardQuote(msg), attachments: [],
      forwardFromId: msg.id, forwardAttachCount: attachmentCount(msg), mode: 'forward',
    })
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
    setCompose({ to: opp.contact_email || '', cc: '', subject, html: '', attachments: [], mode: 'new' })
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
          const when = msg.date_sent ? formatDateTimeCompact(msg.date_sent) : '—'
          const who = correspondent(msg)
          return (
            <TableRow
              key={msg.id}
              onClick={() => void openMessage(msg.id)}
              className="cursor-pointer"
            >
              {/* Date — own column on ≥sm; folded into the content cell on mobile so it can't eat the subject's width */}
              <TableCell className="hidden whitespace-nowrap align-top text-xs text-gray-500 sm:table-cell dark:text-gray-400">
                {when}
              </TableCell>
              <TableCell className={`hidden max-w-44 truncate align-top sm:table-cell ${isUnread ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
                {who}
              </TableCell>
              {/* whitespace-normal overrides the cell default (nowrap) so the subject wraps instead of overflowing the viewport */}
              <TableCell className="whitespace-normal align-top">
                {/* Mobile header line: sender (truncates) + date (right, never overflows) — mail-client style */}
                <div className="mb-0.5 flex items-baseline gap-2 sm:hidden">
                  <span className={`min-w-0 flex-1 truncate text-xs ${isUnread ? 'font-semibold text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}`}>{who}</span>
                  <span className="flex-shrink-0 whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">{when}</span>
                </div>
                <div className={`flex flex-wrap items-center gap-1.5 ${isUnread ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                  {isUnread && <span aria-hidden className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 self-start rounded-full bg-brand-600 sm:mt-0 sm:self-auto" />}
                  <span className="min-w-0 break-words">{msg.subject || t('mailboxNoSubject')}</span>
                  {msg.has_attachments && <span aria-hidden title={t('mailboxAttachments')}>📎</span>}
                  {chipOpp && (
                    <Badge variant="neutral" size="sm">{chipOpp.team_name || chipOpp.club_name}</Badge>
                  )}
                </div>
                {msg.snippet && (
                  <div className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">{msg.snippet}</div>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  // Stacked thread layout for the per-opponent focus dialog: date + correspondent
  // on the first line, then subject and preview each on their own full-width line
  // below. The shared table (renderRows) overflows the narrower dialog because the
  // snippet cell is nowrap — stacking keeps everything wide and wrap-friendly, no
  // horizontal scroll.
  const renderThread = (list: MailboxMessage[]) => (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {list.map((msg) => {
        const isUnread = msg.direction === 'in' && !msg.read_at
        const when = msg.date_sent ? formatDateTimeCompact(msg.date_sent) : '—'
        const who = correspondent(msg)
        return (
          <li key={msg.id}>
            <button
              type="button"
              onClick={() => void openMessage(msg.id)}
              className="flex w-full flex-col gap-0.5 px-1 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              {/* Line 1: date + correspondent */}
              <div className="flex items-baseline gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="whitespace-nowrap">{when}</span>
                <span className="min-w-0 flex-1 truncate">{who}</span>
                {isUnread && <span aria-hidden className="h-2 w-2 flex-shrink-0 self-center rounded-full bg-brand-600" />}
              </div>
              {/* Line 2: subject — full width, wraps */}
              <div className={`flex items-center gap-1.5 text-sm ${isUnread ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                <span className="min-w-0 break-words">{msg.subject || t('mailboxNoSubject')}</span>
                {msg.has_attachments && <span aria-hidden title={t('mailboxAttachments')}>📎</span>}
              </div>
              {/* Line 3: preview — full width, clamped to 2 lines */}
              {msg.snippet && (
                <div className="line-clamp-2 break-words text-xs text-gray-400 dark:text-gray-500">{msg.snippet}</div>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )

  // When a search is active, `results` (server-side: subject + sender/recipient
  // + full body) replaces the cached list; otherwise show the cached list with
  // the show-all collapse. Either way the list is scoped to the active folder
  // (Inbox = received, Sent = sent). Search results are shown in full.
  const inFolder = (m: MailboxMessage) => (folder === 'inbox' ? m.direction === 'in' : m.direction === 'out')
  const searchActive = results !== null
  const list = (results ?? messages).filter(inFolder)
  const visible = searchActive ? list : (showAll ? list : list.slice(0, COLLAPSED_COUNT))
  const inboxCount = messages.reduce((n, m) => n + (m.direction === 'in' ? 1 : 0), 0)
  const sentCount = messages.length - inboxCount

  const folderTab = (key: Folder, label: string, count: number) => (
    <button
      type="button"
      onClick={() => { setFolder(key); setShowAll(false) }}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        folder === key
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-gold-400'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
      }`}
    >
      <span>{label}</span>
      <span className="text-xs text-gray-400 tabular-nums dark:text-gray-500">{count}</span>
    </button>
  )

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
              <Button size="sm" onClick={() => setCompose({ to: '', cc: '', subject: '', html: '', attachments: [], mode: 'new' })}>
                {t('mailboxNew')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleSync()} disabled={syncing}>
                {syncing ? (
                  <span className="flex items-center gap-2">
                    <InlineSpinner />
                    {t('mailboxChecking')}
                  </span>
                ) : (
                  t('mailboxCheckNow')
                )}
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
              {/* Inbox / Sent folder tabs */}
              <div className="mb-3 flex items-center gap-1 border-b border-gray-200 pb-2 dark:border-gray-700">
                {folderTab('inbox', t('mailboxFolderInbox'), inboxCount)}
                {folderTab('sent', t('mailboxFolderSent'), sentCount)}
              </div>
              <div className="mb-3">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={t('mailboxSearchPlaceholder')}
                  className="min-h-11 sm:min-h-0 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
                {(searching || searchActive) && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {searching ? t('mailboxSearching') : t('mailboxSearchCount', { count: list.length })}
                  </p>
                )}
              </div>
              {!searching && list.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">{searchActive ? t('mailboxSearchEmpty') : t('mailboxFolderEmpty')}</p>
              ) : (
                <>
                  {renderRows(visible, true)}
                  {!searchActive && list.length > COLLAPSED_COUNT && (
                    <button
                      type="button"
                      onClick={() => setShowAll((v) => !v)}
                      className="inline-flex items-center min-h-11 sm:min-h-0 mt-2 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {showAll ? t('mailboxShowLess') : t('mailboxShowAll', { count: list.length })}
                    </button>
                  )}
                </>
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
                  : renderThread(focusMessages)}
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
                <DialogDescription className="max-h-24 overflow-y-auto break-words">
                  {t('mailboxFrom')}:{' '}
                  <span className="break-all">{detail.from_name ? `${detail.from_name} <${detail.from_address}>` : detail.from_address}</span>
                  {' · '}{t('mailboxTo')}: <span className="break-all">{detail.to_addresses}</span>
                  {detail.date_sent ? ` · ${formatDateTimeCompact(detail.date_sent)}` : ''}
                </DialogDescription>
              </DialogHeader>
              {detail.body_html ? (
                /* Sandboxed so the email HTML can't touch the app DOM. */
                <iframe
                  title={detail.subject || t('mailboxNoSubject')}
                  srcDoc={emailSrcDoc(detail.body_html)}
                  sandbox=""
                  className="h-96 w-full rounded-md border border-gray-200 bg-white dark:border-gray-700"
                />
              ) : (
                <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                  {detail.body_text || ''}
                </div>
              )}
              <MailboxAttachments message={detail} sport={sport} />
              <MailboxAssign
                message={detail}
                opponentContacts={opponentContacts}
                classification={classification}
                onAssign={async (oppId) => {
                  const ids = threadIdsForMessage(messages, detail.id)
                  try {
                    await mailbox.assignThread(ids, oppId)
                    setDetail((d) => (d && d.id === detail.id ? { ...d, assigned_opponent: oppId } : d))
                    toast.success(t(oppId == null ? 'mailboxAssignCleared' : 'mailboxAssignDone'))
                  } catch (err) {
                    const body = (err as { body?: { error?: string } })?.body
                    toast.error(body?.error || t('mailboxAssignFailed'))
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => startReply(detail, false)}>{t('mailboxReply')}</Button>
                <Button size="sm" variant="outline" onClick={() => startReply(detail, true)}>{t('mailboxReplyAll')}</Button>
                <Button size="sm" variant="outline" onClick={() => startForward(detail)}>{t('mailboxForward')}</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Compose / reply / reply-all / forward */}
      <Dialog open={!!compose} onOpenChange={(o) => { if (!o) setCompose(null) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {compose?.mode === 'reply' ? t('mailboxReply')
                : compose?.mode === 'replyAll' ? t('mailboxReplyAll')
                : compose?.mode === 'forward' ? t('mailboxForward')
                : t('mailboxNew')}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('mailboxNew')}</DialogDescription>
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
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxCc')}</label>
                <input
                  type="text"
                  value={compose.cc}
                  onChange={(e) => setCompose({ ...compose, cc: e.target.value })}
                  placeholder={t('mailboxCcPlaceholder')}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              </div>
              {compose.mode === 'forward' && (compose.forwardAttachCount ?? 0) > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <Paperclip className="h-3.5 w-3.5" />
                  {t('mailboxForwardAttachments', { count: compose.forwardAttachCount })}
                </p>
              )}
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
                <div className="mt-1">
                  <RichTextEditor
                    value={compose.html}
                    onChange={(html) => setCompose({ ...compose, html })}
                    placeholder={t('mailboxBody')}
                    minHeight="10rem"
                  />
                </div>
              </div>
              <div>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 sm:min-h-9 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
                  <Paperclip className="h-4 w-4" />
                  {t('mailboxAttach')}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => { addAttachments(e.target.files); e.target.value = '' }}
                  />
                </label>
                {compose.attachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {compose.attachments.map((f, i) => (
                      <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900">
                        <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                        <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">{f.name}</span>
                        <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">{formatBytes(f.size)}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(i)}
                          aria-label={t('mailboxRemoveAttachment')}
                          title={t('mailboxRemoveAttachment')}
                          className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setCompose(null)}>{t('cancel')}</Button>
                <Button
                  size="sm"
                  onClick={() => void handleSend()}
                  disabled={sending || !compose.to.trim() || !compose.subject.trim() || !compose.html.trim()}
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

/**
 * Manual classification override. Auto-classification handles the vast majority,
 * but for genuinely ambiguous chains (shared club contact, forwarded mail with
 * no KSCW marker) a spielplaner can pin the whole chain to the right opponent.
 * Pinning applies to the entire thread; "Auto-detected" clears it.
 */
function MailboxAssign({
  message,
  opponentContacts,
  classification,
  onAssign,
}: {
  message: MailboxMessageFull
  opponentContacts: OpponentContacts[]
  classification: Map<number, MessageClassification>
  onAssign: (opponentId: number | null) => Promise<void>
}) {
  const { t } = useTranslation('gameScheduling')
  const [saving, setSaving] = useState(false)
  const isPinned = message.assigned_opponent != null
  const ownerId = classification.get(message.id)?.ownerId ?? null

  const labelFor = (oc: OpponentContacts) => oc.opp.team_name || oc.opp.club_name || `#${oc.opp.id}`
  // Group the picker by KSCW team (the alias), so "DU23-1 · VBC Limmattal …"
  // sits under its team — the disambiguation that matters when codes repeat.
  const groups = useMemo(() => {
    const m = new Map<string, OpponentContacts[]>()
    for (const oc of opponentContacts) {
      const key = oc.aliases?.[0] || '—'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(oc)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [opponentContacts])

  const ownerLabel = useMemo(() => {
    if (!ownerId) return null
    const oc = opponentContacts.find((o) => String(o.opp.id) === ownerId)
    if (!oc) return null
    return `${oc.aliases?.[0] ? `${oc.aliases[0]} · ` : ''}${labelFor(oc)}`
  }, [ownerId, opponentContacts])

  if (opponentContacts.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/50">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxAssignLabel')}</span>
      <select
        value={String(message.assigned_opponent ?? '')}
        disabled={saving}
        onChange={(e) => { setSaving(true); void onAssign(e.target.value ? Number(e.target.value) : null).finally(() => setSaving(false)) }}
        className="min-h-9 min-w-[12rem] flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        <option value="">{t('mailboxAssignAuto')}</option>
        {groups.map(([team, list]) => (
          <optgroup key={team} label={team}>
            {list.map((oc) => (
              <option key={String(oc.opp.id)} value={String(oc.opp.id)}>{labelFor(oc)}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {/* Show WHO it resolved to: the manually-pinned opponent, the auto-detected
          owner, or a muted hint when it genuinely couldn't be auto-detected. */}
      {isPinned ? (
        <Badge variant="neutral" size="sm">{t('mailboxAssignPinned')}</Badge>
      ) : ownerLabel ? (
        <Badge variant="info" size="sm" title={t('mailboxAssignAutoDetectedHint')}>{ownerLabel}</Badge>
      ) : (
        <span className="text-xs italic text-gray-400 dark:text-gray-500">{t('mailboxAssignNotDetected')}</span>
      )}
    </div>
  )
}

function MailboxAttachments({ message, sport }: { message: MailboxMessageFull; sport: MailboxSport }) {
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
      await downloadMailboxAttachment(message.id, index, filename, sport)
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
          className="min-h-11 sm:min-h-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {downloading === i ? '…' : `📎 ${a.filename}`}
        </button>
      ))}
    </div>
  )
}
