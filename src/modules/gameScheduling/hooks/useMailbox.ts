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

  return { configured, messages, unread, lastSync, isLoading, syncing, sending, refetch, sync, loadMessage, sendReply }
}
