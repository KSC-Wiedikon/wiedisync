import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, CloudDownload, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { API_URL, kscwApi } from '../../../lib/api'
import { decryptDocument, unwrapContentKey, type Envelope } from '../../../lib/e2ee'
import { cacheDocument, clearCachedDocuments, loadCachedDocuments } from '../../../lib/e2eeStore'
import { useIdentityKeys } from '../../../hooks/useIdentityKeys'
import { formatTimeZurich, idWindowState } from '../../../utils/dateHelpers'

/** The document is only DISPLAYED in this window. See the honesty note below. */
const SHOW_BEFORE_MS = 45 * 60 * 1000

interface SheetRow {
  member: number | null
  number: number | null
  last_name: string
  first_initial: string
  is_captain: boolean
  is_libero: boolean
  dropped: boolean
}

interface SheetResponse {
  data: {
    game: { home_team: string; away_team: string; date: string; time: string | null }
    roster: SheetRow[]
  }
}

interface DocResponse {
  data: { iv: string; mime: string | null; envelope: Envelope; kickoff: string | null }
}

interface Card {
  member: number
  number: number | null
  name: string
  is_captain: boolean
  is_libero: boolean
  url: string | null
  missing?: boolean
}

interface ShowIdsModalProps {
  gameId: string
  /** Kickoff, as an epoch ms. Drives the display window. */
  kickoffMs: number | null
  onClose: () => void
}

/**
 * The players' identity documents, for a coach to hand to a referee.
 *
 * THE TIME WINDOW IS NOT A CRYPTOGRAPHIC BOUNDARY, and it is worth being honest about that
 * rather than implying otherwise in the UI. A hall has no signal, so the coach must pre-load
 * before they travel — which means the key reaches their device early, and it is this client
 * that then declines to display it outside the 45 minutes before kickoff. A coach determined
 * to keep a copy could. So could a coach who simply photographs the screen.
 *
 * What the window and the audit log DO buy: the documents are not casually browsable all
 * season, they are wiped from the phone when the window closes, and every single open is
 * recorded server-side against the person who did it. That is accountability, not
 * impossibility — and for a volleyball club, accountability is the thing that was missing.
 */
export default function ShowIdsModal({ gameId, kickoffMs, onClose }: ShowIdsModalProps) {
  const { t } = useTranslation('games')
  const { state, privateKey, unlock } = useIdentityKeys()

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [roster, setRoster] = useState<SheetRow[]>([])
  const [cards, setCards] = useState<Card[] | null>(null)
  const [cachedCount, setCachedCount] = useState(0)
  const [idx, setIdx] = useState(0)

  // Date.now() lives inside the helper, not here — React treats it as impure during render.
  const windowState = idWindowState(kickoffMs)
  const opensAt = kickoffMs != null ? kickoffMs - SHOW_BEFORE_MS : null
  const canShow = windowState === 'open'
  const beforeWindow = windowState === 'before'

  // Live window: re-render at the exact moments the state flips. A coach waiting
  // at the table opens this BEFORE the window — without a tick the "Show" button
  // stays dead past the opening time (and the at-kickoff cache wipe below only
  // fires on a re-render). No dep array on purpose: every render re-schedules a
  // single timeout for the NEXT boundary still ahead, so after the open boundary
  // fires the same effect arms the kickoff one.
  const [, setWindowTick] = useState(0)
  useEffect(() => {
    if (kickoffMs == null) return
    const now = Date.now()
    const next = [kickoffMs - SHOW_BEFORE_MS, kickoffMs].filter((b) => b > now)
    if (!next.length) return
    const id = setTimeout(() => setWindowTick((n) => n + 1), Math.min(...next) - now + 250)
    return () => clearTimeout(id)
  })

  // Roster: who is on the sheet, so the deck is ordered and labelled like the match sheet.
  useEffect(() => {
    let cancelled = false
    kscwApi<SheetResponse>(`/scorer/game/${gameId}/roster`)
      .then((res) => { if (!cancelled) setRoster(res.data.roster.filter((r) => !r.dropped && r.member != null)) })
      .catch(() => { if (!cancelled) setRoster([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [gameId])

  // How much is already on this device?
  useEffect(() => {
    let cancelled = false
    loadCachedDocuments(gameId).then((d) => { if (!cancelled) setCachedCount(d.length) })
    return () => { cancelled = true }
  }, [gameId])

  // Once the window has passed, the squad's IDs have no business sitting on a phone.
  useEffect(() => {
    if (windowState === 'closed') void clearCachedDocuments(gameId)
  }, [gameId, windowState])

  /** Pull ciphertext + envelopes onto the device. Do this while you still have signal. */
  const preload = useCallback(async () => {
    setBusy(true)
    let ok = 0
    try {
      for (const r of roster) {
        if (r.member == null) continue
        try {
          const meta = await kscwApi<DocResponse>(`/identity/document/${r.member}`)
          const res = await fetch(`${API_URL}/kscw/identity/document/${r.member}/bytes`, {
            credentials: 'include',
          })
          if (!res.ok) continue
          await cacheDocument({
            gameId,
            memberId: r.member,
            ciphertext: await res.arrayBuffer(),
            iv: meta.data.iv,
            mime: meta.data.mime,
            envelope: meta.data.envelope,
          })
          ok++
        } catch {
          // A player with no document, or one whose envelope was never wrapped to this
          // coach, is simply absent from the deck — not a failure of the whole download.
        }
      }
      setCachedCount(ok)
      toast.success(t('idsDownloaded', { count: ok }))
    } finally {
      setBusy(false)
    }
  }, [gameId, roster, t])

  /** Decrypt what is on the device. Works with no connection at all. */
  const reveal = useCallback(async () => {
    if (!privateKey) return
    setBusy(true)
    try {
      const cached = await loadCachedDocuments(gameId)
      const byMember = new Map(cached.map((c) => [c.memberId, c]))

      const built: Card[] = []
      for (const r of roster) {
        if (r.member == null) continue
        const name = `${r.last_name}${r.first_initial ? `, ${r.first_initial}` : ''}`
        const c = byMember.get(r.member)
        if (!c) {
          built.push({ member: r.member, number: r.number, name, is_captain: r.is_captain, is_libero: r.is_libero, url: null, missing: true })
          continue
        }
        try {
          const key = await unwrapContentKey(c.envelope, privateKey)
          const plain = await decryptDocument(new Uint8Array(c.ciphertext), c.iv, key)
          built.push({
            member: r.member,
            number: r.number,
            name,
            is_captain: r.is_captain,
            is_libero: r.is_libero,
            url: URL.createObjectURL(new Blob([plain as BlobPart], { type: c.mime ?? 'image/jpeg' })),
          })
        } catch {
          // A dead envelope (the coach re-keyed since it was wrapped) fails here rather
          // than showing a broken image to a referee.
          built.push({ member: r.member, number: r.number, name, is_captain: r.is_captain, is_libero: r.is_libero, url: null, missing: true })
        }
      }
      setCards(built)
      setIdx(0)
    } catch {
      toast.error(t('idsDecryptFailed'))
    } finally {
      setBusy(false)
    }
  }, [gameId, roster, privateKey, t])

  // Every decrypted document is a live blob URL. Revoke them when the deck is replaced and
  // when the modal closes — an ID still reachable in the page afterwards is exactly what
  // this feature exists to prevent.
  useEffect(() => () => {
    for (const c of cards ?? []) if (c.url) URL.revokeObjectURL(c.url)
  }, [cards])

  const withDocs = useMemo(() => (cards ?? []).filter((c) => !c.missing), [cards])
  const missing = useMemo(() => (cards ?? []).filter((c) => c.missing), [cards])
  const card = withDocs[idx]

  const title = t('idsTitle')

  return (
    <Modal open onClose={onClose} title={title} size="lg" disableAutoFocus>
      {loading && <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!loading && (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-lg bg-accent p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {kickoffMs != null
                ? t('idsWindow', { time: formatTimeZurich(new Date(kickoffMs - SHOW_BEFORE_MS).toISOString()) })
                : t('idsNoKickoff')}
            </p>
          </div>

          {/* The key. A coach unlocks once per device, not once per game. */}
          {(state === 'locked' || state === 'none') && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {state === 'none' ? t('idsNoKey') : t('idsUnlockHint')}
              </p>
              {state === 'locked' && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('idsPasswordPlaceholder')}
                    aria-label={t('idsPasswordPlaceholder')}
                    className="h-11 flex-1 rounded-md border bg-background px-3 text-sm dark:bg-gray-800"
                  />
                  <Button
                    loading={busy}
                    disabled={!password}
                    onClick={async () => {
                      setBusy(true)
                      try { await unlock(password); setPassword('') } catch { toast.error(t('idsWrongPassword')) } finally { setBusy(false) }
                    }}
                  >
                    <Lock className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t('idsUnlock')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {state === 'unlocked' && !cards && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => void preload()} loading={busy}>
                  <CloudDownload className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t('idsPreload')}
                </Button>
                {/* With nothing cached, Show downloads first — the separate preload
                    button exists for the no-signal-in-the-hall case, but a coach
                    standing at the table WITH signal shouldn't be dead-ended by it. */}
                <Button
                  onClick={() => void (async () => { if (cachedCount === 0) await preload(); await reveal() })()}
                  loading={busy}
                  disabled={!canShow}
                >
                  {t('idsShow')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {cachedCount > 0 ? t('idsReadyOffline', { count: cachedCount }) : t('idsPreloadHint')}
              </p>
              {beforeWindow && opensAt != null && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {t('idsLockedUntil', { time: formatTimeZurich(new Date(opensAt).toISOString()) })}
                </p>
              )}
              {!canShow && !beforeWindow && kickoffMs != null && (
                <p className="text-xs text-destructive">{t('idsWindowClosed')}</p>
              )}
            </div>
          )}

          {/* The deck. One document per player, swiped with a thumb. */}
          {cards && withDocs.length > 0 && card && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary text-xl font-bold tabular-nums text-primary-foreground">
                  {card.number ?? '—'}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-base font-bold uppercase leading-tight">{card.name}</div>
                  <div className="flex gap-1.5 pt-0.5">
                    {card.is_captain && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-secondary-foreground">{t('pregameCaptain')}</span>}
                    {card.is_libero && <span className="rounded-full border border-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary">{t('pregameLibero')}</span>}
                  </div>
                </div>
              </div>

              <img
                src={card.url ?? ''}
                alt={card.name}
                className="max-h-[55vh] w-full rounded-lg border bg-background object-contain"
              />

              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label={t('idsPrev')}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="flex-1 text-center text-sm tabular-nums text-muted-foreground">
                  {idx + 1} / {withDocs.length}
                </span>
                <Button variant="outline" size="icon" onClick={() => setIdx((i) => Math.min(withDocs.length - 1, i + 1))} disabled={idx >= withDocs.length - 1} aria-label={t('idsNext')}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {missing.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('idsMissing', { count: missing.length, names: missing.map((m) => m.name).join(', ') })}
                </p>
              )}
            </div>
          )}

          {cards && withDocs.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('idsNone')}</p>
          )}
        </div>
      )}
    </Modal>
  )
}
