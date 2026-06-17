import { useCallback, useEffect, useRef, useState } from 'react'
import { kscwApi, API_URL, getAccessToken } from '../../../lib/api'
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
  text: string
  reply_to_id?: number
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

/** Does this message involve any of the given contact addresses? */
export function messageMatchesContacts(msg: MailboxMessage, contacts: Set<string>): boolean {
  if (contacts.size === 0) return false
  if (msg.direction === 'in') {
    return !!msg.from_address && contacts.has(msg.from_address)
  }
  return `${msg.to_addresses || ''},${msg.cc_addresses || ''}`
    .split(',')
    .some((a) => a && contacts.has(a.trim().toLowerCase()))
}

export function messagesForOpponent(messages: MailboxMessage[], opp: GameSchedulingOpponent): MailboxMessage[] {
  const contacts = contactAddressSet(opp)
  return messages.filter((m) => messageMatchesContacts(m, contacts))
}

export interface OpponentContacts {
  opp: GameSchedulingOpponent
  contacts: Set<string>
  /**
   * Extra disambiguating needles beyond opp.team_name — typically the KSCW
   * pairing's short name ("Legends" / "D1"), so a "… – KSC Wiedikon Legends"
   * mail is routed to the Legends pairing's thread even when several opponent
   * rows of the same club share one contact set. Not used by the row chip.
   */
  aliases?: string[]
}

/**
 * Best opponent row for a message. One club contact often serves several
 * teams (one opponent row per KSCW team × opponent team — e.g. the same
 * person for VC Tornado Adliswil D1 AND H2), so a bare address match is
 * ambiguous. Disambiguate by which opponent team/club name appears in the
 * subject or snippet; the longest matching name wins, so "… Adliswil H2"
 * beats the shared club prefix "… Adliswil". Falls back to the first
 * address match when no name appears.
 */
export function bestOpponentForMessage(
  msg: MailboxMessage,
  opponentContacts: OpponentContacts[],
): GameSchedulingOpponent | null {
  const matches = opponentContacts.filter(({ contacts }) => messageMatchesContacts(msg, contacts))
  if (matches.length <= 1) return matches[0]?.opp || null
  const hay = `${msg.subject || ''} ${msg.snippet || ''}`.toLowerCase()
  let best: GameSchedulingOpponent | null = null
  let bestLen = 0
  for (const { opp } of matches) {
    for (const name of [opp.team_name, opp.club_name]) {
      const needle = String(name || '').trim().toLowerCase()
      if (needle.length > bestLen && hay.includes(needle)) {
        best = opp
        bestLen = needle.length
      }
    }
  }
  return best || matches[0].opp
}

/** Disambiguating needles for one opponent: its team name + any aliases. */
function threadNeedles(oc: OpponentContacts): string[] {
  return [oc.opp.team_name, ...(oc.aliases || [])]
    .map((s) => String(s || '').trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Messages belonging to one opponent's *thread* (the "N emails" button on an
 * opponent card / the per-opponent dialog). A bare contact-address match
 * over-collects: one club's contacts often serve several opponent rows (one
 * per KSCW pairing — e.g. Volley Uster D1 AND Volley Uster H4 share the same
 * 15 club contacts), so D1's thread would otherwise show H4's mail.
 *
 * We therefore drop a contact-matching message from this opponent's thread
 * only when it *names a different* opponent that shares these contacts (by
 * team name or KSCW-pairing alias) and does NOT name this one. A message that
 * names this opponent — or names no specific opponent at all — stays:
 * genuinely-ambiguous mail is better shown on every related thread than
 * silently hidden from the one you're looking at.
 */
export function messagesForOpponentThread(
  messages: MailboxMessage[],
  opp: GameSchedulingOpponent,
  opponentContacts: OpponentContacts[],
): MailboxMessage[] {
  const self = opponentContacts.find((oc) => String(oc.opp.id) === String(opp.id))
  const contacts = self?.contacts ?? contactAddressSet(opp)
  const myNeedles = self ? threadNeedles(self) : threadNeedles({ opp, contacts })
  return messages.filter((msg) => {
    if (!messageMatchesContacts(msg, contacts)) return false
    const rivals = opponentContacts.filter(
      (oc) => String(oc.opp.id) !== String(opp.id) && messageMatchesContacts(msg, oc.contacts),
    )
    if (rivals.length === 0) return true
    const hay = `${msg.subject || ''} ${msg.snippet || ''}`.toLowerCase()
    const named = (needles: string[]) => needles.some((n) => hay.includes(n))
    if (named(myNeedles)) return true
    return !rivals.some((r) => named(threadNeedles(r)))
  })
}

/**
 * Download an attachment through the authed endpoint (a plain <a href> can't
 * carry the Bearer token). Streams live from IMAP server-side.
 */
export async function downloadMailboxAttachment(messageId: number, index: number, filename: string): Promise<void> {
  const token = getAccessToken()
  const res = await fetch(`${API_URL}/kscw/admin/terminplanung/mailbox/attachment/${messageId}/${index}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
}

export function useMailbox(enabled: boolean = true): UseMailboxReturn {
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
      const resp = await kscwApi<MailboxListResponse>('/admin/terminplanung/mailbox')
      if (seq !== fetchSeq.current) return
      setConfigured(resp.configured)
      setMessages(Array.isArray(resp.messages) ? resp.messages : [])
      setUnread(Number(resp.unread) || 0)
      setLastSync(resp.last_sync)
    } finally {
      if (seq === fetchSeq.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refetch().catch(() => { /* panel shows its empty state */ })
  }, [enabled, refetch])

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      await kscwApi('/admin/terminplanung/mailbox/sync', { method: 'POST' })
      await refetch()
    } finally {
      setSyncing(false)
    }
  }, [refetch])

  const loadMessage = useCallback(async (id: number) => {
    const resp = await kscwApi<{ message: MailboxMessageFull }>(`/admin/terminplanung/mailbox/message/${id}`)
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
  }, [])

  const sendReply = useCallback(async (payload: MailboxReplyPayload) => {
    setSending(true)
    try {
      await kscwApi('/admin/terminplanung/mailbox/reply', { method: 'POST', body: payload })
      await refetch()
    } finally {
      setSending(false)
    }
  }, [refetch])

  // Server-side full-text search (subject + sender/recipient + body_text). Does
  // NOT mutate the cached `messages` list — the panel keeps its own results
  // state so the opponent thread/chip features still read the full list.
  const searchMessages = useCallback(async (q: string) => {
    const resp = await kscwApi<MailboxListResponse>(
      `/admin/terminplanung/mailbox?search=${encodeURIComponent(q)}`)
    return Array.isArray(resp.messages) ? resp.messages : []
  }, [])

  return { configured, messages, unread, lastSync, isLoading, syncing, sending, refetch, sync, loadMessage, sendReply, searchMessages }
}
