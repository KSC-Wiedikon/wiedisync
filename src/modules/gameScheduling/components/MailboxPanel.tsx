import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, ChevronDown, Paperclip, Users, X } from 'lucide-react'
import { useConfirm } from '../../../components/ConfirmProvider'
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
  type MailboxAccount,
  type MailboxBulkPreview,
  type MailboxGroup,
  type MailboxGroupsResponse,
  type MailboxMessage,
  type MailboxMessageFull,
  type MailboxRecipient,
  type MessageClassification,
  type OpponentContacts,
  type UseMailboxReturn,
} from '../hooks/useMailbox'
import type { GameSchedulingOpponent } from '../../../types'

const COLLAPSED_COUNT = 10

/** Above this, expanding an audience into individual chips asks first. */
const EXPAND_CONFIRM_THRESHOLD = 60

/** Compose modes — new mail, reply, reply-all, forward, or a group send.
 *  `group` addresses an audience (a team, all Schreiber, …) instead of typed
 *  addresses, and is club-mailbox-only: the server registers the bulk route on
 *  the /admin/mailbox family alone. */
type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | 'group'

/** Inbox = received (direction in), Sent = sent (direction out). */
type Folder = 'inbox' | 'sent'

// ⚠ Both MIRROR `mailbox-audience-select.js` — keep them in step. A season is a
// modifier rather than an audience, and it can only scope audiences whose
// membership actually varies by season: rosters, sports and the team-derived
// functions. A section, a qualification or the register do not, and the server
// REJECTS that combination outright rather than quietly returning the unscoped
// audience — so the picker has to drop the season itself, visibly, instead of
// letting the operator build a filter that cannot resolve.
const SEASON_KEY_PREFIX = 'season:'
const SEASON_SCOPED_PREFIXES = ['sport:', 'fn:', 'team:']
const isSeasonScopable = (key: string) => SEASON_SCOPED_PREFIXES.some((p) => key.startsWith(p))

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
  /** Blind-carbon-copy recipients. Group send only, and like `cc` they receive
   *  ONE copy rather than one per recipient — see the bulk endpoint. */
  bcc?: string
  /** Group send: committed audience filters. Each entry is a drilled path whose
   *  audiences INTERSECT ("Volleyball" + "All coaches" = the 20 volleyball
   *  coaches); the entries themselves UNION, so several filters mix freely. */
  clauses?: string[][]
  /** The filter currently being drilled, not yet added to the recipients. Kept
   *  apart from `clauses` so narrowing never changes who the mail goes to until
   *  the operator commits it. */
  draft?: string[]
  /** Group send: people picked individually, by expanding an audience into
   *  chips. Held alongside `groups`, not instead of it — an operator can mail
   *  two whole teams plus three named people, and the server unions the lot. */
  picked?: MailboxRecipient[]
  mode: ComposeMode
}

interface Props {
  mailbox: UseMailboxReturn
  /** Which mailbox account this panel is showing — passed through to attachment
   *  downloads so they hit the right account, and used to derive our own address
   *  (kept out of reply-all recipients). Includes the non-sport `admin` account. */
  sport?: MailboxAccount
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
  // KSCW-team filter (volleyball only — opponentContacts carry the team alias).
  const [teamFilter, setTeamFilter] = useState('')
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
  const confirm = useConfirm()

  // ── Group send (club mailbox only) ────────────────────────────────────
  // Catalogue is fetched lazily the first time a group compose is opened —
  // every entry costs an audience resolution server-side, so there is no point
  // paying for it on a panel the operator only uses to read mail.
  const isClubMailbox = sport === 'admin'
  const [groups, setGroups] = useState<MailboxGroupsResponse | null>(null)
  // Keyed by the group it describes, so "is this preview current?" is a
  // comparison rather than a second piece of state. Storing a `loading` flag
  // instead would mean writing state synchronously inside the effect below,
  // which is the cascading-render pattern the hooks lint rule rejects.
  const [preview, setPreview] = useState<{ group: string; data: MailboxBulkPreview | null } | null>(null)
  const { fetchGroups, fetchGroupCounts, previewBulk, expandGroups, sendBulk } = mailbox
  // Server-side constant, delivered with the message list — so it is present in
  // every compose mode and every mailbox, not just where /groups was fetched.
  const signatureHtml = mailbox.signatureHtml

  // Selection is order-independent, so the cache key is SORTED — toggling A
  // then B must not re-resolve what B then A already resolved. The key encodes
  // the whole selection (audiences + individually-picked people) rather than
  // just the group list, and is complete enough to rebuild the request from:
  // the effect below parses it back instead of closing over `compose`, which
  // changes on every keystroke in the subject and would re-resolve constantly.
  // Cc/Bcc are deliberately NOT in the key — they never change who is
  // resolved, so typing an address must not re-run the audience query.
  const composeClauses = compose?.mode === 'group' ? (compose.clauses ?? []) : []
  const composePicked = compose?.mode === 'group' ? (compose.picked ?? []) : []
  const composeKey = (composeClauses.length > 0 || composePicked.length > 0)
    ? JSON.stringify({
      c: composeClauses.map((cl) => [...cl].sort()).sort((a, b) => a.join().localeCompare(b.join())),
      m: composePicked.filter((r) => r.kind === 'member').map((r) => Number(r.id)).sort((a, b) => a - b),
      e: composePicked.filter((r) => r.kind === 'clubdesk').map((r) => r.email).sort(),
    })
    : ''

  // The filter being drilled gets its own resolution, so the operator sees what
  // a narrowing step costs BEFORE committing it. Separate from the recipients
  // preview above: that one answers "who gets this mail", this one answers
  // "how big is the thing I am about to add".
  const composeDraft = compose?.mode === 'group' ? (compose.draft ?? []) : []
  // A season alone is not an audience — it is a modifier on one (the server
  // rejects `season:X` with nothing to scope). The draft therefore only counts
  // as "something is selected" once a real audience chip is in it, or opening
  // the composer on the seeded season would show a resolution error where the
  // operator has not yet picked anything.
  const draftAudienceKeys = composeDraft.filter((k) => !k.startsWith(SEASON_KEY_PREFIX))
  const draftKey = draftAudienceKeys.length > 0 ? JSON.stringify([...composeDraft].sort()) : ''
  const [draftPreview, setDraftPreview] = useState<{ key: string; count: number | null } | null>(null)
  const draftCurrent = !!draftKey && draftPreview?.key === draftKey
  const draftCount = draftCurrent ? draftPreview?.count ?? null : null
  const previewCurrent = !!composeKey && preview?.group === composeKey
  const previewData = previewCurrent ? preview?.data ?? null : null
  const previewLoading = !!composeKey && !previewCurrent

  useEffect(() => {
    if (compose?.mode !== 'group' || groups) return
    let cancelled = false
    void (async () => {
      try {
        const resp = await fetchGroups()
        if (cancelled) return
        setGroups(resp)
        // Open scoped to the current season. Seeded here rather than at the
        // click that opens the composer because the catalogue (and therefore
        // which season is current) is only known after this fetch. `seasons` is
        // newest-first and is present only when the club has more than one on
        // file — with a single season there is nothing to scope and nothing to
        // seed.
        const current = resp.seasons?.[0]?.key
        if (current) {
          setCompose((c) => (
            c && c.mode === 'group' && (c.draft ?? []).length === 0 ? { ...c, draft: [current] } : c
          ))
        }
      } catch {
        if (!cancelled) toast.error(t('mailboxGroupsLoadFailed'))
      }
    })()
    return () => { cancelled = true }
  }, [compose?.mode, groups, fetchGroups, t])

  // Live chip counts — what each chip would make the audience if added to the
  // current draft. Same latest-wins keying as the previews: a slow response for
  // an older draft must never paint numbers against the current one.
  const [liveCounts, setLiveCounts] = useState<{ key: string; counts: Record<string, number> } | null>(null)
  const countsKey = compose?.mode === 'group' ? JSON.stringify([...composeDraft].sort()) : ''
  const countsCurrent = !!countsKey && liveCounts?.key === countsKey

  useEffect(() => {
    if (!countsKey || liveCounts?.key === countsKey) return
    let cancelled = false
    void (async () => {
      try {
        const resp = await fetchGroupCounts(JSON.parse(countsKey) as string[])
        if (!cancelled) setLiveCounts({ key: countsKey, counts: resp.counts })
      } catch {
        // Counts are decoration on top of a catalogue that already loaded.
        // Falling back to the static numbers is right; blanking them would
        // read as "this audience is empty", which is a lie that could stop an
        // operator sending a mail they should send.
        if (!cancelled) setLiveCounts({ key: countsKey, counts: {} })
      }
    })()
    return () => { cancelled = true }
  }, [countsKey, liveCounts?.key, fetchGroupCounts])

  // Resolve the selected audience on every change. This is the ONLY way an
  // operator can see who a send would reach before committing to it, so it runs
  // automatically rather than behind a button they might skip.
  useEffect(() => {
    if (!composeKey || preview?.group === composeKey) return
    let cancelled = false
    void (async () => {
      try {
        const sel = JSON.parse(composeKey) as { c: string[][]; m: number[]; e: string[] }
        const p = await previewBulk({ groups: [], clauses: sel.c, members: sel.m, emails: sel.e })
        // Store the selection alongside the result: a slow response for a
        // previous selection must never be shown against the current one.
        if (!cancelled) setPreview({ group: composeKey, data: p })
      } catch {
        if (!cancelled) {
          setPreview({ group: composeKey, data: null })
          toast.error(t('mailboxPreviewFailed'))
        }
      }
    })()
    return () => { cancelled = true }
  }, [composeKey, preview?.group, previewBulk, t])

  // Resolve the draft filter's size. Same latest-wins keying as above.
  useEffect(() => {
    if (!draftKey || draftPreview?.key === draftKey) return
    let cancelled = false
    void (async () => {
      try {
        const keys = JSON.parse(draftKey) as string[]
        const p = await previewBulk({ groups: [], clauses: [keys] })
        if (!cancelled) setDraftPreview({ key: draftKey, count: p.recipient_count })
      } catch {
        if (!cancelled) setDraftPreview({ key: draftKey, count: null })
      }
    })()
    return () => { cancelled = true }
  }, [draftKey, draftPreview?.key, previewBulk])

  /** Human label for a group key: teams show their roster name (data, never
   *  translated), fixed groups resolve through i18n. */
  const groupLabel = (g: MailboxGroup) => g.name ?? t(`mailboxGroup_${g.key.replace(/[:.]/g, '_')}`)

  /** Replace one audience chip with a chip per person in it, so the operator
   *  can drop individuals. The audience itself is removed from `groups` in the
   *  same update — leaving both would re-add everyone they just took out. */
  const handleExpandClause = async (clause: string[]) => {
    // A single chip can be 671 people. Rendering that many names unannounced
    // turns one click into a wall of chips, so anything large asks first — the
    // operator usually wants the audience, not 671 removable rows.
    const est = clause.length === 1
      ? [...(groups?.seasons ?? []), ...(groups?.groups ?? []), ...(groups?.teams ?? [])].find((x) => x.key === clause[0])?.count ?? 0
      : 0
    if (est > EXPAND_CONFIRM_THRESHOLD) {
      const ok = await confirm({ message: t('mailboxExpandLarge', { count: est }) })
      if (!ok) return
    }
    try {
      const resp = await expandGroups(clause)
      const sig = [...clause].sort().join('|')
      setCompose((prev) => {
        if (!prev) return prev
        const seen = new Set((prev.picked ?? []).map((r) => String(r.id)))
        const merged = [...(prev.picked ?? [])]
        for (const r of resp.recipients) {
          if (seen.has(String(r.id))) continue
          seen.add(String(r.id))
          merged.push(r)
        }
        return {
          ...prev,
          clauses: (prev.clauses ?? []).filter((cl) => [...cl].sort().join('|') !== sig),
          picked: merged,
        }
      })
    } catch {
      toast.error(t('mailboxExpandFailed'))
    }
  }

  const handleSendGroup = async () => {
    if (!compose || !previewData) return
    if (!compose.clauses?.length && !compose.picked?.length) return
    if (previewData.recipient_count === 0) return
    // Mass mail is irreversible and goes to real members — confirm with the
    // resolved number, not the group name, so the operator sees the blast size.
    const ok = await confirm({
      message: t('mailboxGroupConfirm', { count: previewData.recipient_count }),
      danger: true,
    })
    if (!ok) return
    try {
      const picked = compose.picked ?? []
      const result = await sendBulk({
        groups: [],
        clauses: compose.clauses ?? [],
        members: picked.filter((r) => r.kind === 'member').map((r) => Number(r.id)),
        emails: picked.filter((r) => r.kind === 'clubdesk').map((r) => r.email),
        cc: compose.cc || undefined,
        bcc: compose.bcc || undefined,
        subject: compose.subject,
        html: compose.html,
        attachments: compose.attachments,
      })
      setCompose(null)
      setPreview(null)
      if (result.failed > 0) toast.warning(t('mailboxGroupSentPartial', { sent: result.sent, failed: result.failed }))
      else toast.success(t('mailboxGroupSent', { count: result.sent }))
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      toast.error(body?.error || (err instanceof Error ? err.message : String(err)))
    }
  }

  // Classify the whole list once: contact match + KSCW team code / opponent
  // name, with thread inheritance for forwarded/stripped replies. Drives both
  // the row chip and the per-opponent thread so they always agree.
  const classification = useMemo(() => classifyMessages(messages, opponentContacts), [messages, opponentContacts])

  // KSCW-team filter support: opponent → its team alias (e.g. "DU23-1"). A message
  // belongs to a team if its classified owner (or, when ambiguous, any candidate)
  // is one of that team's opponents.
  const oppById = useMemo(() => new Map(opponentContacts.map((oc) => [String(oc.opp.id), oc])), [opponentContacts])
  const teamOptions = useMemo(() => {
    const s = new Set<string>()
    for (const oc of opponentContacts) { const a = oc.aliases?.[0]; if (a) s.add(a) }
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [opponentContacts])
  // Auto-clear a stale filter (e.g. after switching to the basketball account).
  const effectiveTeamFilter = teamOptions.includes(teamFilter) ? teamFilter : ''
  const messageInTeam = (msg: MailboxMessage, team: string): boolean => {
    const c = classification.get(msg.id)
    if (!c) return false
    const ids = c.ownerId ? [c.ownerId] : c.candidateIds
    return ids.some((id) => oppById.get(id)?.aliases?.[0] === team)
  }

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
  // Mirrors the fromAddress of each account in scheduling-mailbox.js.
  const selfAddress =
    sport === 'basketball' ? 'basketball@spielplanung.kscw.ch'
      : sport === 'admin' ? 'admin@wiedisync.kscw.ch'
        : 'volleyball@spielplanung.kscw.ch'

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
    // Close the opponent thread dialog explicitly. `new` now renders the
    // full-screen composer, which returns before this dialog's JSX — pulling
    // an open Radix dialog out of the tree that way skips its close handling
    // and can leave the body scroll-locked. Clearing focus lets it close
    // normally, and Cancel then returns to the list rather than re-opening a
    // thread the operator has already acted on.
    onClearFocus()
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
  const list = (results ?? messages)
    .filter(inFolder)
    .filter((m) => !effectiveTeamFilter || messageInTeam(m, effectiveTeamFilter))
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

  // ── Composer surface ──────────────────────────────────────────────────
  // New mail and group send take over the panel as their own screen instead
  // of opening a dialog. The audience picker alone renders ~45 chips, and
  // stacked with a subject field and a rich-text editor it overflowed the
  // `sm:max-w-xl` dialog — the Send button ended up below the fold with no
  // way to scroll to it, i.e. the feature was unreachable at that width.
  // Reply/reply-all/forward keep the dialog: they open from a message you
  // are reading, carry no picker, and stay short.
  const composeFullScreen = !!compose && (compose.mode === 'new' || compose.mode === 'group')

  const composeTitle = (c: ComposeState) =>
    c.mode === 'reply' ? t('mailboxReply')
      : c.mode === 'replyAll' ? t('mailboxReplyAll')
        : c.mode === 'forward' ? t('mailboxForward')
          : c.mode === 'group' ? t('mailboxGroupSend')
            : t('mailboxNew')

  // Recipients half: an audience picker for a group send, typed To/Cc
  // otherwise. Split out so the dialog and the full-screen surface render
  // byte-identical fields rather than drifting into two versions.
  /** Display label for a selected audience key, resolved out of the catalogue. */
  const keyLabel = (key: string) => {
    const g = [...(groups?.seasons ?? []), ...(groups?.groups ?? []), ...(groups?.teams ?? [])].find((x) => x.key === key)
    return g ? groupLabel(g) : key
  }
  const keyCount = (key: string) =>
    [...(groups?.seasons ?? []), ...(groups?.groups ?? []), ...(groups?.teams ?? [])].find((x) => x.key === key)?.count

  const composeRecipients = (c: ComposeState) =>
    c.mode === 'group' ? (
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxTo')}</label>
          {/* The To box holds whole audiences AND individual people side by
              side. An audience chip can be unfolded into its members, which is
              the only way to drop one person from an otherwise-right group. */}
          <div className="mt-1 flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-gray-300 bg-white p-2 dark:border-gray-600 dark:bg-gray-900">
            {(c.clauses ?? []).length === 0 && (c.picked ?? []).length === 0 && (
              <span className="px-1 text-sm text-gray-400 dark:text-gray-500">{t('mailboxRecipientsEmpty')}</span>
            )}
            {(c.clauses ?? []).map((clause, ci) => (
              <span
                key={clause.join('|')}
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-brand-500 bg-brand-500 px-2.5 py-0.5 text-xs text-white"
              >
                <Users className="h-3 w-3 flex-shrink-0" />
                {/* The whole drilled path, so a narrowed filter never reads as
                    the broad audience it was narrowed from. */}
                <span>{clause.map(keyLabel).join(' · ')}</span>
                {clause.length === 1 && keyCount(clause[0]) != null && (
                  <span className="text-white/80">{keyCount(clause[0])}</span>
                )}
                <button
                  type="button"
                  onClick={() => void handleExpandClause(clause)}
                  aria-label={t('mailboxExpandGroup')}
                  title={t('mailboxExpandGroup')}
                  className="rounded p-0.5 hover:bg-white/20"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setCompose({ ...c, clauses: (c.clauses ?? []).filter((_, i) => i !== ci) })}
                  aria-label={t('mailboxRemoveRecipient')}
                  title={t('mailboxRemoveRecipient')}
                  className="rounded p-0.5 hover:bg-white/20"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {(c.picked ?? []).map((r) => (
              <span
                key={String(r.id)}
                title={r.email}
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              >
                <span>{r.name}</span>
                <button
                  type="button"
                  onClick={() => setCompose({ ...c, picked: (c.picked ?? []).filter((p) => String(p.id) !== String(r.id)) })}
                  aria-label={t('mailboxRemoveRecipient')}
                  title={t('mailboxRemoveRecipient')}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
          <GroupPreview
            preview={previewData}
            loading={previewLoading}
            selected={(c.clauses ?? []).length > 0 || (c.picked ?? []).length > 0}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxCc')}</label>
            <input
              type="text"
              value={c.cc}
              onChange={(e) => setCompose({ ...c, cc: e.target.value })}
              placeholder={t('mailboxCcPlaceholder')}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxBcc')}</label>
            <input
              type="text"
              value={c.bcc ?? ''}
              onChange={(e) => setCompose({ ...c, bcc: e.target.value })}
              placeholder={t('mailboxCcPlaceholder')}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
        </div>
        {/* Stated inline, not in a tooltip: the natural assumption is that Cc
            behaves like Cc on a normal mail, and here it cannot — one copy is
            the whole point, and getting it wrong means N copies to one person. */}
        {((c.cc ?? '').trim() || (c.bcc ?? '').trim()) && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('mailboxCcOnceHint')}</p>
        )}

        {/* Drill builder. Each chip picked here NARROWS the filter rather than
            adding a separate audience — "Volleyball" then "All coaches" is the
            20 volleyball coaches, not 309 people. Committing it as one chip is
            what lets several narrowed filters be mixed in one message. */}
        <div className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxGroupLabel')}</label>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {(c.draft ?? []).length === 0 ? (
              <span className="text-xs text-gray-400 dark:text-gray-500">{t('mailboxDrillStart')}</span>
            ) : (
              (c.draft ?? []).map((key, i) => (
                <span key={key} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-gray-400 dark:text-gray-500">›</span>}
                  <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
                    {keyLabel(key)}
                    <button
                      type="button"
                      onClick={() => setCompose({ ...c, draft: (c.draft ?? []).filter((k) => k !== key) })}
                      aria-label={t('mailboxRemoveRecipient')}
                      title={t('mailboxRemoveRecipient')}
                      className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </span>
              ))
            )}
          </div>

          {/* Gated on a real audience, not merely on a non-empty draft: with the
              current season seeded the draft is never empty, and a season alone
              resolves to nothing — so this row would sit on a spinner that never
              finishes before the operator had picked anything. */}
          {draftAudienceKeys.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {draftCount == null
                  ? <span className="inline-flex items-center gap-1.5"><InlineSpinner /> {t('mailboxPreviewLoading')}</span>
                  : t('mailboxDrillCount', { count: draftCount })}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={draftCount === 0}
                onClick={() => {
                  const draft = c.draft ?? []
                  const sig = [...draft].sort().join('|')
                  const existing = c.clauses ?? []
                  // Adding the same filter twice is a no-op, not a duplicate —
                  // the send would dedupe anyway, but two identical chips read
                  // as "twice as many people".
                  const next = existing.some((cl) => [...cl].sort().join('|') === sig)
                    ? existing
                    : [...existing, draft]
                  setCompose({ ...c, clauses: next, draft: [] })
                }}
              >
                {t('mailboxDrillAdd')}
              </Button>
            </div>
          )}

          <div className="mt-2">
            <AudiencePicker
              groups={groups}
              selected={c.draft ?? []}
              counts={countsCurrent ? liveCounts?.counts ?? null : null}
              onToggle={(key) => {
                const cur = c.draft ?? []
                if (cur.includes(key)) {
                  setCompose({ ...c, draft: cur.filter((k) => k !== key) })
                  return
                }
                let next = [...cur, key]
                // Only one season at a time — picking a second replaces the
                // first rather than producing a clause the server reads as
                // "last one wins", which would silently discard the visible chip.
                if (key.startsWith(SEASON_KEY_PREFIX)) {
                  next = [...cur.filter((k) => !k.startsWith(SEASON_KEY_PREFIX)), key]
                } else if (!isSeasonScopable(key)) {
                  // The seeded season cannot scope this audience. Drop it and
                  // SAY so — leaving it in builds a filter the send rejects,
                  // and removing it quietly would change the audience under an
                  // operator who watched themselves select a season.
                  const season = cur.find((k) => k.startsWith(SEASON_KEY_PREFIX))
                  if (season) {
                    next = next.filter((k) => !k.startsWith(SEASON_KEY_PREFIX))
                    toast.info(t('mailboxSeasonDropped', {
                      season: season.slice(SEASON_KEY_PREFIX.length),
                    }))
                  }
                }
                setCompose({ ...c, draft: next })
              }}
              onClear={() => setCompose({ ...c, draft: [] })}
              labelFor={groupLabel}
            />
          </div>
        </div>
      </div>
    ) : (
      <>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxTo')}</label>
          <input
            type="text"
            value={c.to}
            onChange={(e) => setCompose({ ...c, to: e.target.value })}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxCc')}</label>
          <input
            type="text"
            value={c.cc}
            onChange={(e) => setCompose({ ...c, cc: e.target.value })}
            placeholder={t('mailboxCcPlaceholder')}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
      </>
    )

  // Message half: subject, body, attachments.
  const composeMessage = (c: ComposeState) => (
    <>
      {c.mode === 'forward' && (c.forwardAttachCount ?? 0) > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Paperclip className="h-3.5 w-3.5" />
          {t('mailboxForwardAttachments', { count: c.forwardAttachCount })}
        </p>
      )}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxSubject')}</label>
        <input
          type="text"
          value={c.subject}
          onChange={(e) => setCompose({ ...c, subject: e.target.value })}
          maxLength={300}
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxBody')}</label>
        <div className="mt-1">
          <RichTextEditor
            value={c.html}
            onChange={(html) => setCompose({ ...c, html })}
            placeholder={t('mailboxBody')}
            minHeight={composeFullScreen ? '16rem' : '10rem'}
          />
        </div>
        {c.mode === 'group' && (
          // The merge tokens are passed as VALUES, not written into the
          // translation: a literal {{vorname}} in a locale string would
          // be interpolated away by i18next before it ever rendered.
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('mailboxGroupMergeHint', { first: '{{vorname}}', last: '{{nachname}}' })}
          </p>
        )}
      </div>
      {/* The club signature has always been appended server-side, but the
          composer never showed it — so an operator writing into an empty
          editor had every reason to add their own sign-off under one they
          could not see. Read-only on purpose: it is not editable per-message,
          and rendering it as an input would imply it is.
          `dangerouslySetInnerHTML` is safe here: this markup is a server-side
          constant from scheduling-signature.js, never user input. */}
      {signatureHtml && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('mailboxSignatureLabel')}</label>
          <div className="mt-1 rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900/50">
            {/* Emails render on white in every client; pinning it here keeps
                the crest and the blue text legible in the app's dark theme. */}
            <div className="overflow-x-auto rounded bg-white p-2">
              <div dangerouslySetInnerHTML={{ __html: signatureHtml }} />
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('mailboxSignatureHint')}</p>
          </div>
        </div>
      )}
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
        {c.attachments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {c.attachments.map((f, i) => (
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
    </>
  )

  const composeActions = (c: ComposeState) => (
    <>
      <Button size="sm" variant="outline" onClick={() => setCompose(null)}>{t('cancel')}</Button>
      {c.mode === 'group' ? (
        // Gated on a resolved, non-empty preview: without it there is
        // no way to know how many people a click would mail.
        <Button
          size="sm"
          onClick={() => void handleSendGroup()}
          disabled={sending || previewLoading || !previewData || previewData.recipient_count === 0 || !c.subject.trim() || !c.html.trim()}
        >
          {sending ? t('mailboxSending')
            : previewData ? t('mailboxGroupSendCount', { count: previewData.recipient_count })
            : t('mailboxSend')}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={sending || !c.to.trim() || !c.subject.trim() || !c.html.trim()}
        >
          {sending ? t('mailboxSending') : t('mailboxSend')}
        </Button>
      )}
    </>
  )

  // Full-screen composer replaces the list entirely — the message list is not
  // useful while writing, and leaving it mounted underneath is what forced the
  // cramped dialog in the first place.
  if (composeFullScreen && compose) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCompose(null)}
            aria-label={t('mailboxBackToInbox')}
            title={t('mailboxBackToInbox')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle>{composeTitle(compose)}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Two columns once there is room: the audience picker is tall, and
              side-by-side keeps the subject + editor in view while chips are
              toggled. Single column on <lg and for plain new mail. */}
          <div className={compose.mode === 'group' ? 'grid items-start gap-6 lg:grid-cols-2' : 'space-y-3'}>
            <div className="space-y-3">{composeRecipients(compose)}</div>
            <div className="space-y-3">{composeMessage(compose)}</div>
          </div>
          {/* The card's own footer, in normal flow. It was sticky at first so
              Send stayed reachable, but pinned to the viewport it read as a
              floating bar belonging to the page rather than to this card. The
              composer is its own full-height screen, so scrolling to the end
              reaches Send anyway. */}
          <div className="-mx-6 -mb-6 mt-6 flex items-center justify-end gap-2 rounded-b-lg border-t border-gray-200 bg-card px-6 py-3 dark:border-gray-700">
            {composeActions(compose)}
          </div>
        </CardContent>
      </Card>
    )
  }

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
              {isClubMailbox && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCompose({ to: '', cc: '', bcc: '', subject: '', html: '', attachments: [], clauses: [], draft: [], mode: 'group' })}
                >
                  <Users className="mr-1.5 h-4 w-4" />
                  {t('mailboxGroupSend')}
                </Button>
              )}
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
              {/* Inbox / Sent folder tabs + (volleyball) KSCW-team filter */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2 dark:border-gray-700">
                <div className="flex items-center gap-1">
                  {folderTab('inbox', t('mailboxFolderInbox'), inboxCount)}
                  {folderTab('sent', t('mailboxFolderSent'), sentCount)}
                </div>
                {teamOptions.length > 0 && (
                  <select
                    value={effectiveTeamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    aria-label={t('mailboxTeamFilterLabel')}
                    className="min-h-9 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="">{t('mailboxTeamFilterAll')}</option>
                    {teamOptions.map((tm) => (
                      <option key={tm} value={tm}>{tm}</option>
                    ))}
                  </select>
                )}
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

      {/* Reply / reply-all / forward. New mail and group send are handled by
          the full-screen composer above and never reach this dialog. */}
      <Dialog open={!!compose && !composeFullScreen} onOpenChange={(o) => { if (!o) setCompose(null) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{compose ? composeTitle(compose) : t('mailboxNew')}</DialogTitle>
            <DialogDescription className="sr-only">{t('mailboxNew')}</DialogDescription>
          </DialogHeader>
          {compose && (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              {composeRecipients(compose)}
              {composeMessage(compose)}
              <div className="flex items-center justify-end gap-2">
                {composeActions(compose)}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Chip rows, in display order. Keys match `section` on the server's group
 *  catalogue; anything with an unrecognised section falls into 'roles'.
 *
 *  Season sits directly above players / roles / teams because those are the
 *  only rows it can scope — a section, a qualification or the register are not
 *  seasonal facts, and picking one drops the season. Leading the picker with a
 *  chip that most of the rows below it reject read as though it scoped
 *  everything. */
const AUDIENCE_SECTIONS = ['everyone', 'sektion', 'season', 'players', 'roles', 'teams', 'former'] as const

// Teams are the one section too long to read as a single row — 29 active teams
// against at most 8 chips anywhere else — so it is split into sport × gender
// buckets. Anything with an unknown sport or gender sorts to the end rather
// than disappearing.
const TEAM_SPORT_ORDER = ['volleyball', 'basketball']
const TEAM_GENDER_ORDER = ['f', 'm', 'mixed']

/**
 * Audience picker — toggle chips grouped into rows.
 *
 * Chips rather than a dropdown because the catalogue is the useful part: an
 * operator needs to SEE that "all scorers" and "all referees" exist, and how
 * big each is, without opening a list and reading it one line at a time. Counts
 * ride on the chip for the same reason.
 *
 * Multi-select unions the audiences and dedupes by address server-side, so
 * picking "All coaches" + "D1" mails a coach of D1 exactly once.
 */
function AudiencePicker({
  groups,
  selected,
  counts,
  onToggle,
  onClear,
  labelFor,
}: {
  groups: MailboxGroupsResponse | null
  selected: string[]
  /** Live per-chip totals for the current draft, or null while they resolve /
   *  if the call failed. Keys absent from the map (former members) keep their
   *  static catalogue count. */
  counts: Record<string, number> | null
  onToggle: (key: string) => void
  onClear: () => void
  labelFor: (g: MailboxGroup) => string
}) {
  const { t } = useTranslation('gameScheduling')
  const bySection = useMemo(() => {
    const map = new Map<string, MailboxGroup[]>()
    for (const g of [...(groups?.seasons ?? []), ...(groups?.groups ?? []), ...(groups?.teams ?? [])]) {
      const key = (AUDIENCE_SECTIONS as readonly string[]).includes(g.section) ? g.section : 'roles'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(g)
    }
    return map
  }, [groups])

  // Teams split into sport × gender buckets, in club order: volleyball first,
  // women before men, mixed last. Alphabetical within a bucket.
  const teamBuckets = useMemo(() => {
    const buckets = new Map<string, MailboxGroup[]>()
    for (const g of bySection.get('teams') ?? []) {
      const key = `${g.sport ?? ''}|${g.gender ?? ''}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(g)
    }
    const rank = (key: string) => {
      const [sport, gender] = key.split('|')
      const s = TEAM_SPORT_ORDER.indexOf(sport)
      const gd = TEAM_GENDER_ORDER.indexOf(gender)
      return [s < 0 ? TEAM_SPORT_ORDER.length : s, gd < 0 ? TEAM_GENDER_ORDER.length : gd]
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => {
        const [as, ag] = rank(a)
        const [bs, bg] = rank(b)
        return as - bs || ag - bg || a.localeCompare(b)
      })
      .map(([key, teams]) => ({
        key,
        teams: [...teams].sort((x, y) => (x.name ?? '').localeCompare(y.name ?? '')),
      }))
  }, [bySection])

  if (!groups) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <InlineSpinner /> {t('mailboxGroupsLoading')}
      </p>
    )
  }

  /** "Volleyball · Women". Falls back to the raw value so a sport or gender
   *  added in Directus shows up as itself rather than as a missing key. */
  const bucketLabel = (key: string) => {
    const [sport, gender] = key.split('|')
    const parts = [
      sport ? t(`mailboxTeamsSport_${sport}`, { defaultValue: sport }) : '',
      gender ? t(`gender_${gender}`, { defaultValue: gender }) : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : t('mailboxTeamsOther')
  }

  const chip = (g: MailboxGroup) => {
    const on = selected.includes(g.key)
    // The live number is what this chip would make the audience, so it can go
    // UP (same-section chips union) as well as down. Falls back to the static
    // catalogue count while the first response is in flight.
    const live = counts?.[g.key]
    const shown = live ?? g.count
    // count === null means "no size of its own" (season), not "empty". A
    // selected chip is never disabled — the operator must always be able to
    // undo the click that emptied the audience.
    const empty = shown === 0 && !on
    return (
      <button
        key={g.key}
        type="button"
        aria-pressed={on}
        disabled={empty}
        onClick={() => onToggle(g.key)}
        // min-h-11 on mobile keeps the touch target at 44px.
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors sm:min-h-8 ${
          on
            ? 'border-brand-500 bg-brand-500 text-white'
            : empty
              ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-600'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
        }`}
      >
        <span>{labelFor(g)}</span>
        {shown != null && <span className={on ? 'text-white/80' : 'text-gray-400 dark:text-gray-500'}>{shown}</span>}
      </button>
    )
  }

  return (
    <div className="mt-1 space-y-2">
      {AUDIENCE_SECTIONS.filter((s) => bySection.has(s)).map((section) => (
        <div key={section}>
          <p className="mb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
            {t(`mailboxSection_${section}`)}
            {/* Says what the chip reaches, so its disappearance when an
                incompatible audience is picked is expected rather than a bug. */}
            {section === 'season' && (
              <span className="ml-1.5 font-normal normal-case">{t('mailboxSeasonScopeHint')}</span>
            )}
          </p>
          {section === 'teams' ? (
            <div className="space-y-1.5">
              {teamBuckets.map((bucket) => (
                <div key={bucket.key}>
                  <p className="mb-1 pl-0.5 text-[11px] text-gray-400 dark:text-gray-500">{bucketLabel(bucket.key)}</p>
                  <div className="flex flex-wrap gap-1.5">{bucket.teams.map(chip)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">{bySection.get(section)!.map(chip)}</div>
          )}
        </div>
      ))}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {t('mailboxGroupClear', { count: selected.length })}
        </button>
      )}
    </div>
  )
}

/**
 * Who a group send would actually reach.
 *
 * Shows the resolved recipient count AND the exclusions behind it, because the
 * interesting number is usually the gap: "team of 14 → 11 emails" is alarming
 * until you can see it is 3 members with no address on file. Silently showing
 * 11 would hide a data problem the club can fix.
 *
 * Names are first name + last initial — enough to sanity-check the audience,
 * never a dump of the club's address list.
 */
function GroupPreview({ preview, loading, selected }: { preview: MailboxBulkPreview | null; loading: boolean; selected: boolean }) {
  const { t } = useTranslation('gameScheduling')
  if (!selected) return null
  if (loading) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <InlineSpinner /> {t('mailboxPreviewLoading')}
      </p>
    )
  }
  if (!preview) return null
  const { skipped } = preview
  const excluded = skipped.noEmail + skipped.optedOut + skipped.duplicate + (skipped.suppressed ?? 0)
  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-900">
      <p className="font-semibold text-gray-900 dark:text-gray-100">
        {t('mailboxPreviewCount', { count: preview.recipient_count })}
      </p>
      {excluded > 0 && (
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          {t('mailboxPreviewExcluded', {
            audience: preview.audience_size,
            noEmail: skipped.noEmail,
            optedOut: skipped.optedOut,
            duplicate: skipped.duplicate,
          })}
        </p>
      )}
      {(skipped.suppressed ?? 0) > 0 && (
        <p className="mt-1 text-amber-600 dark:text-amber-400">
          {t('mailboxPreviewSuppressed', { count: skipped.suppressed })}
        </p>
      )}
      {preview.sample.length > 0 && (
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          {t('mailboxPreviewSample', { names: preview.sample.join(', ') })}
        </p>
      )}
      {preview.recipient_count === 0 && (
        <p className="mt-1 font-medium text-amber-600 dark:text-amber-400">{t('mailboxPreviewEmpty')}</p>
      )}
    </div>
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

function MailboxAttachments({ message, sport }: { message: MailboxMessageFull; sport: MailboxAccount }) {
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
