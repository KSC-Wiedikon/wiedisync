import { useCallback, useEffect, useRef, useState } from 'react'
import { kscwApi, API_URL } from '../../../lib/api'
import type { GameSchedulingOpponent } from '../../../types'

/**
 * Embedded mailbox for the Terminplanung dashboard — a synced copy of the
 * volleyball@spielplanung.kscw.ch Migadu mailbox (see kscw-endpoints
 * scheduling-mailbox.js). Opponent matching happens here, client-side, by
 * address intersection with game_scheduling_opponents.contact_email — no FK,
 * nothing to go stale when contacts change.
 */

export interface MailboxMessage {
  id: number
  message_id: string
  in_reply_to: string | null
  direction: 'in' | 'out'
  from_address: string | null
  from_name: string | null
  to_addresses: string | null
  cc_addresses: string | null
  subject: string | null
  snippet: string | null
  date_sent: string | null
  read_at: string | null
  has_attachments: boolean
  /** Manual opponent override (game_scheduling_opponents.id) set from the
   *  dashboard; wins over auto-classification. null = auto-classify. */
  assigned_opponent?: number | null
}

export interface MailboxAttachment {
  filename: string
  contentType: string
  size: number
}

export interface MailboxMessageFull extends MailboxMessage {
  body_text: string | null
  body_html: string | null
  attachments: MailboxAttachment[] | string | null
}

export interface MailboxReplyPayload {
  to: string
  cc?: string
  subject: string
  /** Rich-text HTML body from the TipTap editor. */
  html: string
  reply_to_id?: number
  /** Forward: source message id whose attachments to re-attach (server fetches
   *  them live from IMAP). Starts a new thread (no In-Reply-To). */
  forward_from_id?: number
  /** Which of the forward source's attachments to include (omit = all). */
  forward_attach_indices?: number[]
  /** Files to attach; posted as multipart/form-data. */
  attachments?: File[]
}

/**
 * A mailbox account a hook/call targets — one Migadu mailbox each. `admin` is
 * the club-admin box (admin@wiedisync.kscw.ch,
 * migration 222) — not a sport, and served from its own route family, because
 * the Spielplanung gate grants `is_spielplaner` and that must never imply access
 * to the club's general inbox.
 */
export type MailboxAccount = 'volleyball' | 'basketball' | 'admin'

/** @deprecated Use MailboxAccount — kept so the Spielplanung callers still typecheck. */
export type MailboxSport = 'volleyball' | 'basketball'

/**
 * Build a mailbox route. The admin account has its own path and takes no
 * `sport` param; the Spielplanung accounts stay on the terminplanung path and
 * pass `?sport=`, which the server reads BEFORE parsing any multipart body so
 * auth runs first.
 */
function mailboxUrl(account: MailboxAccount, suffix = '', extra = ''): string {
  const base = account === 'admin' ? '/admin/mailbox' : '/admin/terminplanung/mailbox'
  const qs = [account === 'admin' ? '' : `sport=${account}`, extra].filter(Boolean).join('&')
  return `${base}${suffix}${qs ? `?${qs}` : ''}`
}

/** Lower-cased bare addresses from a comma/semicolon-joined contact_email. */
export function contactAddressSet(opp: Pick<GameSchedulingOpponent, 'contact_email'>): Set<string> {
  return new Set(
    String(opp.contact_email || '')
      .split(/[,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Every address a message touches — sender + To + Cc — lower-cased. Matching
 *  on the union (not just the sender) means an opponent who is only Cc'd still
 *  routes to their thread, and our own Sent replies match by recipient/Cc. */
function messageAddressSet(
  msg: Pick<MailboxMessage, 'from_address' | 'to_addresses' | 'cc_addresses'>,
): Set<string> {
  const out = new Set<string>()
  const add = (v: string | null | undefined) => {
    for (const a of String(v || '').split(',')) {
      const t = a.trim().toLowerCase()
      if (t) out.add(t)
    }
  }
  add(msg.from_address)
  add(msg.to_addresses)
  add(msg.cc_addresses)
  return out
}

/** Does this message involve any of the given contact addresses? Checks From,
 *  To AND Cc in both directions, so inbound mail that merely Cc's an opponent —
 *  and Sent mail addressed/Cc'd to them — both count as theirs. */
export function messageMatchesContacts(msg: MailboxMessage, contacts: Set<string>): boolean {
  if (contacts.size === 0) return false
  for (const a of messageAddressSet(msg)) if (contacts.has(a)) return true
  return false
}

export function messagesForOpponent(messages: MailboxMessage[], opp: GameSchedulingOpponent): MailboxMessage[] {
  const contacts = contactAddressSet(opp)
  return messages.filter((m) => messageMatchesContacts(m, contacts))
}

export interface OpponentContacts {
  opp: GameSchedulingOpponent
  contacts: Set<string>
  /**
   * The KSCW pairing's team designation(s) — e.g. ["DU23-1"], ["Legends"] —
   * carried by every invite subject we generate ("… – KSC Wiedikon DU23-1 /
   * Spielplanung 2026/27"). This is the *dominant* classification signal: it
   * cleanly separates HU23 from DU23 where the opponent's shared club/team name
   * cannot.
   */
  aliases?: string[]
}

// --- Classification ------------------------------------------------------
//
// One club contact often serves several opponent rows (one per KSCW team ×
// opponent team — e.g. the same VBC Limmattal contact for our HU23 AND DU23),
// so a bare address match is ambiguous. We score every address-matching
// opponent against the subject + snippet and keep the clear winner.

/** Normalise to a space-padded, lower-cased, alphanumeric-token string so a
 *  ` phrase ` lookup becomes a whole-word match — no "Limmattal" inside
 *  "Limmattaler", no "H2" inside "H23", no "DU23" inside "DU234". */
function norm(s: string | null | undefined): string {
  const inner = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return ` ${inner} `
}

/** Whole-token test: is `phrase` present in the (already normalised) haystack? */
function phraseIn(normHay: string, phrase: string): boolean {
  const p = String(phrase || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return p.length > 0 && normHay.includes(` ${p} `)
}

/** Matchable forms of a KSCW team designation: the full name plus — when a
 *  "-N" squad suffix is present — the bare gender+age code. "DU23-1" →
 *  ["du23 1", "du23"]; "D1" / "H3" / "Legends" have no squad suffix so they
 *  yield a single form. The bare code lets a forwarded "… Limmattal Du23 …"
 *  (no squad number) still match the DU23-1 pairing. */
function teamCodeForms(name: string): string[] {
  const full = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!full) return []
  const base = full.replace(/ \d+$/, '')
  return base !== full ? [full, base] : [full]
}

/**
 * The KSCW team designation OUR side of the subject — the token(s) right after
 * the "KSCW" / "KSC Wiedikon" marker — normalised and space-padded, or null
 * when no marker is present. This is what makes classification sound across
 * teams: opponents constantly reuse our own codes ("VBC Embrach D1", "Volley
 * S9 D2", "Wädivolley H2"), and every subject we generate puts OUR team right
 * after the marker — "… (KSCW H2)", "KSCW D2 / VBC Embrach D1", "… – KSC
 * Wiedikon D4". So the opponent's "D1" sits *before* the marker and must never
 * outrank our "D2" that sits *after* it. Extracted from the raw subject (not
 * the normalised haystack) so we can stop at the matchup delimiter — "/", a
 * bracket, a spaced dash, or the "Spielplan…" season tail.
 */
function ourTeamSegment(subject: string | null | undefined): string | null {
  const m = String(subject || '').match(/\b(?:kscw|ksc\s+wiedikon)\b[\s:]*([^/()|\n]*)/i)
  if (!m) return null
  const captured = m[1].split(/\s[–-]\s/)[0].split(/spielplan/i)[0]
  const normed = captured.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return normed ? ` ${normed} ` : null
}

/** Confidence that a message belongs to one opponent row, by name/code only
 *  (the address match is the prerequisite gate, scored elsewhere).
 *
 *  Tiers, highest first:
 *   - 200/160: our team code in the authoritative "KSCW <code>" slot (`seg`) —
 *     full squad name (DU23-1) beats bare code (DU23).
 *   -  60/40 : our code merely appears *somewhere* — could be the OPPONENT's
 *     same-letter team, so it only decides when nothing more specific does
 *     (e.g. forwarded juniors "… Limmattal Du23 …" with no KSCW marker).
 *   -  20/10 : the opponent team / club name appears (team beats club). */
function nameScore(seg: string | null, normHay: string, oc: OpponentContacts): number {
  let codeScore = 0
  for (const alias of oc.aliases || []) {
    const [full, base] = teamCodeForms(alias)
    if (seg && full && phraseIn(seg, full)) { codeScore = Math.max(codeScore, 200); continue }
    if (seg && base && phraseIn(seg, base)) { codeScore = Math.max(codeScore, 160); continue }
    if (full && phraseIn(normHay, full)) codeScore = Math.max(codeScore, 60)
    else if (base && phraseIn(normHay, base)) codeScore = Math.max(codeScore, 40)
  }
  let entityScore = 0
  const team = String(oc.opp.team_name || '').trim()
  const club = String(oc.opp.club_name || '').trim()
  if (team && phraseIn(normHay, team)) entityScore = 20
  else if (club && phraseIn(normHay, club)) entityScore = 10
  return codeScore + entityScore
}

interface ScoredMessage {
  /** Every opponent row whose contacts the message touches. */
  candidates: OpponentContacts[]
  /** Candidates tied at the highest name/code score (all of them when 0). */
  topMatches: OpponentContacts[]
  maxScore: number
}

function scoreMessage(msg: MailboxMessage, opponentContacts: OpponentContacts[]): ScoredMessage {
  const candidates = opponentContacts.filter((oc) => messageMatchesContacts(msg, oc.contacts))
  if (candidates.length <= 1) {
    return { candidates, topMatches: candidates, maxScore: candidates.length ? 0 : -1 }
  }
  const seg = ourTeamSegment(msg.subject)
  const normHay = norm(`${msg.subject || ''} ${msg.snippet || ''}`)
  let maxScore = 0
  const scores = candidates.map((oc) => {
    const s = nameScore(seg, normHay, oc)
    if (s > maxScore) maxScore = s
    return s
  })
  const topMatches = candidates.filter((_, i) => scores[i] === maxScore)
  return { candidates, topMatches, maxScore }
}

/** A single confident owner for a message, or null when genuinely ambiguous
 *  (multiple address candidates, none named or a tie at the top). */
function confidentOwner(s: ScoredMessage): GameSchedulingOpponent | null {
  if (s.candidates.length === 1) return s.candidates[0].opp
  if (s.maxScore > 0 && s.topMatches.length === 1) return s.topMatches[0].opp
  return null
}

/**
 * Best single opponent row for a message — used for the row chip. One club
 * contact often serves several teams, so a bare address match is ambiguous;
 * we disambiguate by the KSCW team code (then opponent name) in the subject /
 * snippet, and fall back to the first address match when nothing is named.
 */
export function bestOpponentForMessage(
  msg: MailboxMessage,
  opponentContacts: OpponentContacts[],
): GameSchedulingOpponent | null {
  const s = scoreMessage(msg, opponentContacts)
  if (s.candidates.length === 0) return null
  return (s.topMatches[0] || s.candidates[0]).opp
}

/** Strip leading reply/forward markers (multilingual) so replies and forwards
 *  group with their originating subject for thread inheritance. */
function threadKey(subject: string | null | undefined): string {
  let s = String(subject || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  let prev: string
  do {
    prev = s
    s = s.replace(/^(?:re|fwd?|aw|wg|tr|sv|antw|antwort|weitergeleitet)\s+/, '')
  } while (s !== prev)
  return s
}

/** Union-find grouping of messages into conversation threads, linked by
 *  In-Reply-To → Message-ID and by normalised base subject. */
function threadRoots(messages: MailboxMessage[]): Map<number, number> {
  const parent = messages.map((_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  const byMessageId = new Map<string, number>()
  messages.forEach((m, i) => { if (m.message_id) byMessageId.set(m.message_id, i) })
  messages.forEach((m, i) => {
    if (m.in_reply_to) { const p = byMessageId.get(m.in_reply_to); if (p != null) union(i, p) }
  })
  const bySubject = new Map<string, number>()
  messages.forEach((m, i) => {
    const k = threadKey(m.subject)
    if (!k) return
    const p = bySubject.get(k)
    if (p != null) union(i, p); else bySubject.set(k, i)
  })
  const roots = new Map<number, number>()
  messages.forEach((m, i) => roots.set(m.id, find(i)))
  return roots
}

export interface MessageClassification {
  /** Confident single owner row id, or null when ambiguous. */
  ownerId: string | null
  /** All opponent rows whose contacts the message touches. */
  candidateIds: string[]
}

/**
 * Classify every message to an opponent row in one pass. Two stages:
 *  1. Score each message by contact match + KSCW team code / opponent name.
 *  2. Thread inheritance — a message with no naming hint of its own inherits
 *     the owner of its conversation thread (In-Reply-To / base subject), but
 *     ONLY when that owner is one of the message's own contact candidates, so
 *     we never invent a link the addresses don't support. This rescues "Re:
 *     Fw:" replies that dropped the team code from the visible subject/snippet.
 */
export function classifyMessages(
  messages: MailboxMessage[],
  opponentContacts: OpponentContacts[],
): Map<number, MessageClassification> {
  const byOppId = new Map(opponentContacts.map((oc) => [String(oc.opp.id), oc.opp]))
  const scored = messages.map((msg) => {
    // Manual override wins outright — but only when it still resolves to a
    // current opponent row (opponents are recreated on resync; a stale id falls
    // back to auto). The assigned opponent is forced into the candidate set so
    // the chain shows on its thread even if no address matches (forwards).
    const manual = msg.assigned_opponent != null ? byOppId.get(String(msg.assigned_opponent)) : undefined
    if (manual) {
      const auto = scoreMessage(msg, opponentContacts).candidates.map((c) => String(c.opp.id))
      return { id: msg.id, owner: manual, candidateIds: [...new Set([String(manual.id), ...auto])] }
    }
    const s = scoreMessage(msg, opponentContacts)
    return {
      id: msg.id,
      owner: confidentOwner(s),
      candidateIds: s.candidates.map((c) => String(c.opp.id)),
    }
  })

  // One confident owner per thread (none when the thread mixes owners).
  const roots = threadRoots(messages)
  const ownersByRoot = new Map<number, Set<string>>()
  for (const m of scored) {
    if (!m.owner) continue
    const root = roots.get(m.id)!
    if (!ownersByRoot.has(root)) ownersByRoot.set(root, new Set())
    ownersByRoot.get(root)!.add(String(m.owner.id))
  }

  const result = new Map<number, MessageClassification>()
  for (const m of scored) {
    let ownerId = m.owner ? String(m.owner.id) : null
    if (!ownerId) {
      const owners = ownersByRoot.get(roots.get(m.id)!)
      if (owners && owners.size === 1) {
        const inherited = [...owners][0]
        if (m.candidateIds.includes(inherited)) ownerId = inherited
      }
    }
    result.set(m.id, { ownerId, candidateIds: m.candidateIds })
  }
  return result
}

/** Does a classified message belong on `oppId`'s thread? Owned-by-another →
 *  no; owned-by-this → yes; genuinely ambiguous → shown on every contact
 *  candidate's thread (better seen on a sibling than silently hidden). */
export function messageBelongsToOpponent(
  c: MessageClassification | undefined,
  oppId: string | number,
): boolean {
  if (!c) return false
  if (c.ownerId != null) return c.ownerId === String(oppId)
  return c.candidateIds.includes(String(oppId))
}

/** The opponent to badge a message with, from a precomputed classification:
 *  the confident owner, or the sole contact candidate, else none (no guessing
 *  a chip when several teams share the contact and nothing is named). */
export function chipOpponentForMessage(
  c: MessageClassification | undefined,
  opponentContacts: OpponentContacts[],
): GameSchedulingOpponent | null {
  if (!c) return null
  const find = (id: string) => opponentContacts.find((o) => String(o.opp.id) === id)?.opp ?? null
  if (c.ownerId != null) return find(c.ownerId)
  if (c.candidateIds.length === 1) return find(c.candidateIds[0])
  return null
}

/**
 * Messages on one opponent's thread, given a precomputed classification (built
 * once per render with classifyMessages). Preferred over the per-call variant
 * below when rendering many opponent rows.
 */
export function messagesForOwner(
  messages: MailboxMessage[],
  oppId: string | number,
  classification: Map<number, MessageClassification>,
): MailboxMessage[] {
  return messages.filter((m) => messageBelongsToOpponent(classification.get(m.id), oppId))
}

/** Every message id in the same conversation thread as `msgId` (In-Reply-To /
 *  base subject) — what a manual assignment is applied to, so pinning a chain
 *  pins the whole chain. Always includes msgId itself. */
export function threadIdsForMessage(messages: MailboxMessage[], msgId: number): number[] {
  const roots = threadRoots(messages)
  const root = roots.get(msgId)
  if (root == null) return [msgId]
  return messages.filter((m) => roots.get(m.id) === root).map((m) => m.id)
}

/**
 * Messages belonging to one opponent's *thread* (the "N emails" button on an
 * opponent card / the per-opponent dialog). Convenience wrapper that classifies
 * the whole list and filters to this opponent — see classifyMessages for the
 * routing rules.
 *
 * PERF: this runs a full classifyMessages() pass (union-find over ALL messages)
 * on every call. Calling it once per opponent row is O(rows × messages) — an
 * O(n²) trap. When rendering many rows, call classifyMessages() ONCE and reuse
 * messagesForOwner(messages, id, classification) instead of this wrapper.
 */
export function messagesForOpponentThread(
  messages: MailboxMessage[],
  opp: GameSchedulingOpponent,
  opponentContacts: OpponentContacts[],
): MailboxMessage[] {
  const classification = classifyMessages(messages, opponentContacts)
  return messagesForOwner(messages, opp.id, classification)
}

/**
 * Download an attachment through the authed endpoint (a plain <a href> can't
 * carry the Bearer token). Streams live from IMAP server-side.
 */
export async function downloadMailboxAttachment(messageId: number, index: number, filename: string, account: MailboxAccount = 'volleyball'): Promise<void> {
  const res = await fetch(`${API_URL}/kscw${mailboxUrl(account, `/attachment/${messageId}/${index}`)}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Attachment download failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface MailboxListResponse {
  configured: boolean
  unread: number
  messages: MailboxMessage[]
  last_sync: string | null
}

export interface UseMailboxReturn {
  /** null until the first fetch resolves */
  configured: boolean | null
  messages: MailboxMessage[]
  unread: number
  lastSync: string | null
  isLoading: boolean
  syncing: boolean
  sending: boolean
  refetch: () => Promise<void>
  /** Trigger an IMAP pull now, then refetch the list. */
  sync: () => Promise<void>
  /** Load full body; the backend stamps read_at, mirrored locally. */
  loadMessage: (id: number) => Promise<MailboxMessageFull>
  sendReply: (payload: MailboxReplyPayload) => Promise<void>
  /** Full-text search across stored mail (subject, sender/recipient AND body),
   *  server-side — returns matches without touching the cached list state. */
  searchMessages: (q: string) => Promise<MailboxMessage[]>
  /** Pin an email chain to an opponent row (null clears it), overriding
   *  auto-classification. `ids` is the whole thread (see threadIdsForMessage). */
  assignThread: (ids: number[], opponentId: number | null) => Promise<void>
}

export function useMailbox(enabled: boolean = true, sport: MailboxAccount = 'volleyball'): UseMailboxReturn {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<MailboxMessage[]>([])
  const [unread, setUnread] = useState(0)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [sending, setSending] = useState(false)
  // Latest-wins guard (same pattern as useTeamAbsences): a slow stale response
  // must not clobber the result of a newer refetch.
  const fetchSeq = useRef(0)

  const refetch = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      const resp = await kscwApi<MailboxListResponse>(mailboxUrl(sport))
      if (seq !== fetchSeq.current) return
      setConfigured(resp.configured)
      setMessages(Array.isArray(resp.messages) ? resp.messages : [])
      setUnread(Number(resp.unread) || 0)
      setLastSync(resp.last_sync)
    } finally {
      if (seq === fetchSeq.current) setIsLoading(false)
    }
  }, [sport])

  useEffect(() => {
    if (!enabled) return
    void refetch().catch(() => { /* panel shows its empty state */ })
  }, [enabled, refetch])

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      await kscwApi(mailboxUrl(sport, '/sync'), { method: 'POST' })
      await refetch()
    } finally {
      setSyncing(false)
    }
  }, [refetch, sport])

  const loadMessage = useCallback(async (id: number) => {
    const resp = await kscwApi<{ message: MailboxMessageFull }>(mailboxUrl(sport, `/message/${id}`))
    const msg = resp.message
    if (msg.read_at) {
      setMessages((prev) => {
        let cleared = false
        const next = prev.map((m) => {
          if (m.id === msg.id && !m.read_at) { cleared = true; return { ...m, read_at: msg.read_at } }
          return m
        })
        if (cleared) setUnread((u) => Math.max(0, u - 1))
        return next
      })
    }
    return msg
  }, [sport])

  // Posts multipart/form-data (HTML body + attachment files) via a raw fetch —
  // kscwApi only speaks JSON, and attachments would exceed Directus's 1 MB JSON
  // body limit. Carries the Bearer token like downloadMailboxAttachment.
  const sendReply = useCallback(async (payload: MailboxReplyPayload) => {
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('to', payload.to)
      if (payload.cc) fd.append('cc', payload.cc)
      fd.append('subject', payload.subject)
      fd.append('html', payload.html)
      if (payload.reply_to_id != null) fd.append('reply_to_id', String(payload.reply_to_id))
      if (payload.forward_from_id != null) fd.append('forward_from_id', String(payload.forward_from_id))
      if (payload.forward_attach_indices != null) fd.append('forward_attach_indices', JSON.stringify(payload.forward_attach_indices))
      for (const f of payload.attachments || []) fd.append('attachments', f, f.name)
      // sport goes in the query string so the server authorizes the account
      // before parsing the multipart body.
      const res = await fetch(`${API_URL}/kscw${mailboxUrl(sport, '/reply')}`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      })
      if (!res.ok) {
        let message = `Send failed (${res.status})`
        try {
          const j = (await res.json()) as { error?: string }
          if (j?.error) message = j.error
        } catch { /* non-JSON error body */ }
        const err = new Error(message) as Error & { body?: { error?: string } }
        err.body = { error: message }
        throw err
      }
      await refetch()
    } finally {
      setSending(false)
    }
  }, [refetch, sport])

  // Server-side full-text search (subject + sender/recipient + body_text). Does
  // NOT mutate the cached `messages` list — the panel keeps its own results
  // state so the opponent thread/chip features still read the full list.
  const searchMessages = useCallback(async (q: string) => {
    const resp = await kscwApi<MailboxListResponse>(
      mailboxUrl(sport, '', `search=${encodeURIComponent(q)}`))
    return Array.isArray(resp.messages) ? resp.messages : []
  }, [sport])

  // Pin / unpin an email chain to an opponent. Optimistically patches the cached
  // list so the chip + thread update instantly, then refetches for consistency.
  // Volleyball-only (basketball has no opponents) — the server enforces this.
  const assignThread = useCallback(async (ids: number[], opponentId: number | null) => {
    const idSet = new Set(ids)
    setMessages((prev) => prev.map((m) => (idSet.has(m.id) ? { ...m, assigned_opponent: opponentId } : m)))
    await kscwApi(mailboxUrl(sport, '/assign'), {
      method: 'POST',
      body: { ids, opponent_id: opponentId },
    })
    await refetch()
  }, [refetch, sport])

  return { configured, messages, unread, lastSync, isLoading, syncing, sending, refetch, sync, loadMessage, sendReply, searchMessages, assignThread }
}
