import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, CloudDownload, Loader2, Lock, Maximize2, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import IconButton from '@/components/IconButton'
import { API_URL, kscwApi } from '../../../lib/api'
import { decryptDocument, unwrapContentKey, type Envelope } from '../../../lib/e2ee'
import { cacheDocument, clearCachedDocuments, loadCachedDocuments, type CachedDoc } from '../../../lib/e2eeStore'
import { useIdentityKeys } from '../../../hooks/useIdentityKeys'
import { useAuth } from '../../../hooks/useAuth'
import { formatDateZurich, formatTimeZurich, gameKickoffMs, idShowBeforeMs, idWindowState } from '../../../utils/dateHelpers'
import { safeBlobType } from '../../../utils/filePreviewKind'
import { burnWatermark, canvasToObjectUrl, fitLongEdge } from '../../../lib/idWatermark'
import { PdfRasterSession, warmPdfRaster } from '../../../lib/pdfRaster'
import { needsShrink, shrinkIdDocument } from '../../../lib/idShrink'
import { storeIdentityDocument } from '../../../lib/identityUpload'
import VmCheckBanner, { type VmCheck } from './VmCheckBanner'

/**
 * Timing trace, `[ids]` in the console — how long the download, each request and each
 * card take. Member ids and sizes only: never a name, a key or document content.
 */
const trace = (...args: unknown[]) => console.info('[ids]', ...args)
const since = (t0: number) => Math.round(performance.now() - t0)
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`

/** What rendering one document cost — filled in by watermarkedUrl for the trace. */
interface RenderTrace {
  kind?: 'photo' | 'pdf'
  px?: string
  drawMs?: number
  encodeMs?: number
}

interface SheetRow {
  member: number | null
  number: number | null
  last_name: string
  first_initial: string
  is_captain: boolean
  is_libero: boolean
  dropped: boolean
  /** Staff only (not playing): shown after the players, with a role badge instead of a number. */
  staff?: boolean
  /** On the sheet's officials block — a playing assistant coach too. Gets the role chip. */
  official?: boolean
  role?: string | null
}

interface SheetResponse {
  data: {
    game: { home_team: string; away_team: string; date: string; time: string | null }
    source?: string
    vm_check?: VmCheck | null
    roster: SheetRow[]
    coaches?: { member: number | null; last_name: string; first_initial: string; role: string | null }[]
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
  /** Watermark baked into the pixels; false → the CSS overlay carries it instead. */
  burned?: boolean
  /** Last resort only: a PDF pdf.js could not rasterise goes to the native viewer in a frame. */
  isPdf?: boolean
  staff?: boolean
  official?: boolean
  role?: string | null
}

/** Badge text for an official, where a player shows their jersey number. */
const ROLE_SHORT: Record<string, string> = { coach: 'C', assistant_coach_1: 'A1', assistant_coach_2: 'A2', physio: 'P', doctor: 'D' }

/**
 * Burn a use-restriction watermark INTO the decrypted document, on a canvas, before
 * anything reaches the screen. A screenshot (or a saved blob) then carries
 * "club · purpose · who · when" in the pixels — it spoils reuse of the document
 * elsewhere and ties any leaked copy back to the audit-logged open. A CSS
 * overlay would look identical but dies the moment someone opens the blob URL
 * directly.
 *
 * Photos are drawn from an <img>; PDFs are rasterised on-device with pdf.js
 * (every page, stacked into one image) and get the same burn per page — an
 * installed PWA on a phone cannot show a PDF in a frame, which is how a coach
 * once stood at the table with a "blocked" box instead of the ID. Returns null
 * only when neither works; the caller then falls back to the plain blob plus a
 * CSS overlay, so the label is always at least visually present.
 */
async function watermarkedUrl(
  plain: Uint8Array,
  mime: string,
  label: string,
  pdf: () => PdfRasterSession,
  rt: RenderTrace = {},
): Promise<string | null> {
  if (mime === 'application/pdf') {
    rt.kind = 'pdf'
    try {
      const t0 = performance.now()
      const { canvas, omitted } = await pdf().rasterise(plain, (ctx, rect) => burnWatermark(ctx, rect, label))
      if (omitted > 0) console.warn(`[ids] PDF has ${omitted} page(s) beyond the display cap`)
      rt.px = `${canvas.width}×${canvas.height}`
      rt.drawMs = since(t0)
      const t1 = performance.now()
      // Opaque scan on a white fill: JPEG encodes far faster than PNG on a phone.
      const url = await canvasToObjectUrl(canvas, 'image/jpeg', 0.9)
      rt.encodeMs = since(t1)
      return url
    } catch (err) {
      trace('pdf render failed, falling back to the frame viewer:', err)
      return null
    }
  }
  rt.kind = 'photo'
  let srcUrl: string | null = null
  try {
    const t0 = performance.now()
    srcUrl = URL.createObjectURL(new Blob([plain as BlobPart], { type: safeBlobType(mime) }))
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('not drawable'))
      img.src = srcUrl as string
    })
    if (!img.naturalWidth || !img.naturalHeight) return null
    // Bounded like a PDF page, and JPEG like one: full-size PNG made each photo
    // seconds of work on a phone and a ~15 MB blob.
    const { w, h } = fitLongEdge(img.naturalWidth, img.naturalHeight)
    rt.px = `${img.naturalWidth}×${img.naturalHeight} → ${w}×${h}`
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // White bed: JPEG has no alpha, and a transparent PNG upload would turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    burnWatermark(ctx, { x: 0, y: 0, w, h }, label)
    rt.drawMs = since(t0)
    const t1 = performance.now()
    const url = await canvasToObjectUrl(canvas, 'image/jpeg', 0.9)
    rt.encodeMs = since(t1)
    return url
  } catch (err) {
    trace(`${mime} could not be drawn, showing it unburned:`, err)
    return null
  } finally {
    if (srcUrl) URL.revokeObjectURL(srcUrl)
  }
}

/** One player's card: decrypt the cached document and burn the watermark in. Never throws. */
async function buildCard(
  r: SheetRow & { member: number },
  c: CachedDoc | undefined,
  privateKey: CryptoKey,
  label: string,
  pdf: () => PdfRasterSession,
): Promise<Card> {
  const base = {
    member: r.member,
    number: r.number,
    name: `${r.last_name}${r.first_initial ? `, ${r.first_initial}` : ''}`,
    is_captain: r.is_captain,
    is_libero: r.is_libero,
    staff: r.staff === true,
    official: r.official === true,
    role: r.role ?? null,
  }
  if (!c) {
    trace(`card #${r.member}: nothing cached`)
    return { ...base, url: null, missing: true }
  }
  const t0 = performance.now()
  try {
    const key = await unwrapContentKey(c.envelope, privateKey)
    const plain = await decryptDocument(new Uint8Array(c.ciphertext), c.iv, key)
    const decryptMs = since(t0)
    const rt: RenderTrace = {}
    const burned = await watermarkedUrl(plain, c.mime ?? 'image/jpeg', label, pdf, rt)
    trace(`card #${r.member}: ${c.mime ?? '?'} ${kb(c.ciphertext.byteLength)} ${rt.px ?? ''} · decrypt ${decryptMs} ms`
      + ` · ${rt.kind === 'pdf' ? 'rasterise' : 'decode+draw'} ${rt.drawMs ?? '–'} ms · encode ${rt.encodeMs ?? '–'} ms`
      + ` · total ${since(t0)} ms${burned ? '' : ' (UNBURNED fallback)'}`)
    return {
      ...base,
      // The declared mime is the uploader's claim — stamp only a vetted type.
      url: burned ?? URL.createObjectURL(new Blob([plain as BlobPart], { type: safeBlobType(c.mime ?? 'image/jpeg') })),
      burned: burned != null,
      isPdf: burned == null && c.mime === 'application/pdf',
    }
  } catch (err) {
    // A dead envelope (the coach re-keyed since it was wrapped) fails here rather
    // than showing a broken image to a referee.
    trace(`card #${r.member}: decrypt failed after ${since(t0)} ms:`, err)
    return { ...base, url: null, missing: true }
  }
}

/**
 * Re-encode the squad's stored documents that are still above WhatsApp size (idShrink.ts),
 * from the copies this reveal just decrypted. Superadmins only, and the server takes it
 * only from a Directus admin (or the owner): readers are carried forward, never widened
 * (`recompress`, identityUpload.ts). Runs after the deck is built, one at a time; a no-op
 * once the squad is small. The device keeps its (old) cached copies — they still open.
 */
async function shrinkStoredDocs(cached: CachedDoc[], privateKey: CryptoKey): Promise<void> {
  const big = cached.filter((c) => needsShrink(c.ciphertext.byteLength, c.mime))
  if (!big.length) return
  trace(`shrink: ${big.length} stored documents above WhatsApp size — re-encoding`)
  for (const c of big) {
    const t0 = performance.now()
    try {
      const key = await unwrapContentKey(c.envelope, privateKey)
      const plain = await decryptDocument(new Uint8Array(c.ciphertext), c.iv, key)
      const small = await shrinkIdDocument(plain, c.mime ?? 'image/jpeg')
      if (!small || (c.mime !== 'application/pdf' && small.size >= plain.byteLength)) {
        trace(`shrink #${c.memberId}: skipped (not decodable here, or not smaller)`)
        continue
      }
      await storeIdentityDocument({ member: c.memberId, file: small, mime: 'image/jpeg', recompress: true })
      trace(`shrink #${c.memberId}: ${c.mime} ${kb(plain.byteLength)} → ${kb(small.size)}, stored in ${since(t0)} ms`)
    } catch (err) {
      trace(`shrink #${c.memberId}: failed after ${since(t0)} ms:`, err)
      // Refused: not a Directus admin — every other document would be refused too.
      if ((err as { status?: number }).status === 403) return
    }
  }
}

interface ShowIdsViewProps {
  gameId: string
  /**
   * Kickoff, as an epoch ms — drives the display window. Handed over by the game modal;
   * absent on a reload or a direct link, when the sheet's own game date/time is used.
   */
  kickoffMs?: number | null
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
export default function ShowIdsView({ gameId, kickoffMs: kickoffFromCaller }: ShowIdsViewProps) {
  const { t } = useTranslation('games')
  const { state, privateKey, unlock } = useIdentityKeys()
  const { realUser, isSuperAdmin } = useAuth()
  // Plain locals (not `realUser?.x` inside the callback): optional-chained
  // members in a dep array make the React Compiler bail on the memoization.
  const viewerFirstName = realUser?.first_name ?? ''
  const viewerLastName = realUser?.last_name ?? ''

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [roster, setRoster] = useState<SheetRow[]>([])
  const [vmCheck, setVmCheck] = useState<VmCheck | null>(null)
  /** From the sheet — who is playing whom, and (on a reload / direct link) when. */
  const [sheetGame, setSheetGame] = useState<SheetResponse['data']['game'] | null>(null)
  const kickoffMs = kickoffFromCaller ?? (sheetGame ? gameKickoffMs(sheetGame.date, sheetGame.time) : null)
  /** The sheet's head count — every player on it (linked or not), and its liberos. */
  const [sheetCount, setSheetCount] = useState<{ players: number; liberos: number } | null>(null)
  // Bumped by a Volleymanager Recheck to read the sheet again.
  const [sheetKey, setSheetKey] = useState(0)
  const [cards, setCards] = useState<Card[] | null>(null)
  /** Set while the deck is still being decrypted — it is shown card by card as it grows. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [cachedCount, setCachedCount] = useState(0)
  const [idx, setIdx] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  // Every decrypted document is a live blob URL, and an ID still reachable in the page
  // after this closes is exactly what this feature exists to prevent. Tracked here, not
  // derived from `cards`: the deck now grows one card at a time, and an effect keyed on
  // `cards` would revoke the URLs still on screen at every append. `gen` retires a build
  // still running when the modal closes (or a new one starts) — it stops and revokes what
  // it made instead of leaving it behind.
  const deckRef = useRef({ gen: 0, urls: [] as string[] })
  useEffect(() => {
    const deck = deckRef.current
    return () => {
      deck.gen += 1
      for (const u of deck.urls) URL.revokeObjectURL(u)
      deck.urls = []
    }
  }, [])

  // Date.now() lives inside the helpers, not here — React treats it as impure during render.
  const showBeforeMs = idShowBeforeMs(isSuperAdmin)
  const windowState = idWindowState(kickoffMs, showBeforeMs)
  const opensAt = kickoffMs != null ? kickoffMs - showBeforeMs : null
  // The superadmin test window opens days ahead — a bare "20:00" would read as today.
  const fmtOpensAt = (ms: number) => {
    const iso = new Date(ms).toISOString()
    return showBeforeMs > 24 * 60 * 60 * 1000 ? `${formatDateZurich(iso)} ${formatTimeZurich(iso)}` : formatTimeZurich(iso)
  }
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
    const next = [kickoffMs - showBeforeMs, kickoffMs].filter((b) => b > now)
    if (!next.length) return
    const id = setTimeout(() => setWindowTick((n) => n + 1), Math.min(...next) - now + 250)
    return () => clearTimeout(id)
  })

  // Roster: who is on the sheet, so the deck is ordered and labelled like the match sheet.
  useEffect(() => {
    let cancelled = false
    const t0 = performance.now()
    // The same sheet as the scorer's — the Einsatzliste stored at kickoff −45 min, else
    // the RSVPs. Opening this never logs the shared Volleymanager account in.
    kscwApi<SheetResponse>(`/scorer/game/${gameId}/roster`)
      .then((res) => {
        // Officials are checked at the table like players (their ID is shown, a missing one
        // is flagged). Someone who plays AND is an official (a playing assistant coach)
        // stays ONE card, in their player slot, with the role chip on it; staff who do not
        // play follow after the last player.
        const officials = new Map<number, string | null>()
        for (const c of res.data.coaches ?? []) {
          if (c.member != null && !officials.has(c.member)) officials.set(c.member, c.role)
        }
        const players = res.data.roster
          .filter((r) => !r.dropped && r.member != null)
          .map((r) => (officials.has(r.member as number)
            ? { ...r, official: true, role: officials.get(r.member as number) ?? null }
            : r))
        const onSheet = new Set(players.map((r) => r.member))
        const staff: SheetRow[] = [...officials]
          .filter(([m]) => !onSheet.has(m))
          .map(([m, role]) => {
            const c = (res.data.coaches ?? []).find((x) => x.member === m)
            return {
              member: m, number: null, last_name: c?.last_name ?? '', first_initial: c?.first_initial ?? '',
              is_captain: false, is_libero: false, dropped: false, staff: true, official: true, role,
            }
          })
        trace(`sheet for game ${gameId}: ${players.length} players + ${staff.length} staff (source ${res.data.source ?? '?'}, vm check ${res.data.vm_check?.status ?? 'none'}) in ${since(t0)} ms`)
        const onSheetPlayers = res.data.roster.filter((r) => !r.dropped)
        if (!cancelled) {
          setSheetGame(res.data.game)
          setRoster([...players, ...staff])
          setVmCheck(res.data.vm_check ?? null)
          setSheetCount({ players: onSheetPlayers.length, liberos: onSheetPlayers.filter((r) => r.is_libero).length })
        }
      })
      .catch((err) => {
        trace(`sheet for game ${gameId} failed after ${since(t0)} ms:`, err)
        if (!cancelled) setRoster([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [gameId, sheetKey])

  // How much is already on this device?
  useEffect(() => {
    let cancelled = false
    loadCachedDocuments(gameId).then((d) => {
      if (cancelled) return
      trace(`on this device: ${d.length} documents, ${kb(d.reduce((n, c) => n + c.ciphertext.byteLength, 0))}`)
      setCachedCount(d.length)
      // PDFs render through pdf.js, which is lazy-loaded. Pull it (and its worker)
      // into memory now, while this may still be online — the hall has no signal.
      if (d.some((c) => c.mime === 'application/pdf')) void warmPdfRaster()
    })
    return () => { cancelled = true }
  }, [gameId])

  // Once the window has passed, the squad's IDs have no business sitting on a phone.
  useEffect(() => {
    if (windowState === 'closed') void clearCachedDocuments(gameId)
  }, [gameId, windowState])

  /** Pull ciphertext + envelopes onto the device. Do this while you still have signal. */
  const preload = useCallback(async () => {
    setBusy(true)
    const t0 = performance.now()
    let ok = 0
    let bytes = 0
    // Entitled, but never wrapped a key — see `blocked` handling below.
    let blocked = 0
    let hasPdf = false
    const fetchOne = async (member: number, staff: boolean) => {
      const tm = performance.now()
      try {
        const meta = await kscwApi<DocResponse>(`/identity/document/${member}`)
        const metaMs = since(tm)
        const tb = performance.now()
        const res = await fetch(`${API_URL}/kscw/identity/document/${member}/bytes`, {
          credentials: 'include',
        })
        const firstByteMs = since(tb)
        if (!res.ok) {
          trace(`download #${member}: meta ${metaMs} ms · bytes HTTP ${res.status} after ${firstByteMs} ms`)
          return
        }
        const ciphertext = await res.arrayBuffer()
        const bytesMs = since(tb)
        const tc = performance.now()
        await cacheDocument({
          gameId,
          memberId: member,
          ciphertext,
          iv: meta.data.iv,
          mime: meta.data.mime,
          envelope: meta.data.envelope,
        })
        trace(`download #${member}: ${meta.data.mime ?? '?'} ${kb(ciphertext.byteLength)} · meta ${metaMs} ms`
          + ` · bytes ${bytesMs} ms (first byte ${firstByteMs} ms) · store ${since(tc)} ms · done at +${since(t0)} ms`)
        ok++
        bytes += ciphertext.byteLength
        if (meta.data.mime === 'application/pdf') hasPdf = true
      } catch (err) {
        const code = (err as { code?: string }).code
        trace(`download #${member}${staff ? ' (staff)' : ''}: skipped (${code ?? (err as Error).message}) after ${since(tm)} ms`)
        // A player with no document is simply absent from the deck — not a failure of the
        // whole download. But `no_envelope` is NOT that: it means this coach is entitled
        // and holds no key, because they set their identity key up after the upload. That
        // used to be swallowed here, so the symptom was "0 IDs downloaded" with no reason
        // given, discovered at the hall. It is repairable, and the coach must be told.
        // Officials count like players: their ID is checked at the table too.
        if (code === 'no_envelope') blocked += 1
      }
    }
    try {
      // Every player at once, not one after another: two authorised round trips per player
      // (each re-checks access server-side and pulls the file from R2) serialised 14
      // players into ~20–35 s on mobile data. A match sheet is ≤ ~20 players.
      const members = roster.flatMap((r) => (r.member == null ? [] : [{ id: r.member, staff: r.staff === true }]))
      trace(`download start: ${members.length} people (${members.filter((m) => m.staff).length} staff), all at once`)
      await Promise.all(members.map((m) => fetchOne(m.id, m.staff)))
      const downloadMs = since(t0)
      // "Ready offline" must include the renderer: load pdf.js + its worker into
      // memory now, while there is signal (the SW does no caching — see pdfRaster.ts).
      const tp = performance.now()
      const pdfReady = !hasPdf || await warmPdfRaster()
      trace(`download done: ${ok}/${members.length} in ${downloadMs} ms · ${kb(bytes)}`
        + ` · ${downloadMs ? ((bytes * 8) / 1e6 / (downloadMs / 1000)).toFixed(1) : '–'} Mbit/s`
        + `${hasPdf ? ` · pdf.js warm ${since(tp)} ms (${pdfReady ? 'ok' : 'FAILED'})` : ''}${blocked ? ` · ${blocked} without a key` : ''}`)
      setCachedCount(ok)
      toast.success(t('idsDownloaded', { count: ok }))
      if (!pdfReady) toast.warning(t('idsPdfViewerNotReady'), { duration: 10000 })
      if (blocked > 0) toast.warning(t('idsNoEnvelope', { count: blocked }), { duration: 10000 })
    } finally {
      setBusy(false)
    }
  }, [gameId, roster, t])

  /** Decrypt what is on the device. Works with no connection at all. */
  const reveal = useCallback(async () => {
    if (!privateKey) return
    const deck = deckRef.current
    const gen = ++deck.gen
    const stale = () => deck.gen !== gen
    for (const u of deck.urls) URL.revokeObjectURL(u)
    deck.urls = []
    setCards(null)
    setIdx(0)
    setBusy(true)
    // One pdf.js worker for every PDF in the squad, created on the first one.
    let pdfSession: PdfRasterSession | null = null
    const pdf = () => (pdfSession ??= new PdfRasterSession())
    const t0 = performance.now()
    let firstMs: number | null = null
    try {
      const cached = await loadCachedDocuments(gameId)
      const byMember = new Map(cached.map((c) => [c.memberId, c]))
      const rows = roster.filter((r): r is SheetRow & { member: number } => r.member != null)
      trace(`reveal start: ${cached.length} cached for ${rows.length} players (read from device ${since(t0)} ms)`)
      setProgress({ done: 0, total: rows.length })
      // Not localized on purpose: a screenshot travels, and the label must
      // stay legible wherever it lands.
      const viewer = [viewerFirstName, viewerLastName].filter(Boolean).join(' ')
      // In sheet order, each card shown the moment it is ready: the coach is looking at
      // the first ID while the rest are still being decrypted, instead of at a spinner
      // until the last of 14 is done.
      for (const [i, r] of rows.entries()) {
        const nowIso = new Date().toISOString()
        const label = ['KSC Wiedikon', 'Spielkontrolle / match check', viewer,
          `${formatDateZurich(nowIso)} ${formatTimeZurich(nowIso)}`].filter(Boolean).join(' · ')
        const next = await buildCard(r, byMember.get(r.member), privateKey, label, pdf)
        if (stale()) {
          if (next.url) URL.revokeObjectURL(next.url)
          return
        }
        if (next.url) deck.urls.push(next.url)
        if (firstMs == null && !next.missing) {
          firstMs = since(t0)
          trace(`first ID on screen after ${firstMs} ms`)
        }
        setCards((prev) => [...(prev ?? []), next])
        setProgress({ done: i + 1, total: rows.length })
      }
      trace(`reveal done: ${rows.length} players in ${since(t0)} ms (first ID after ${firstMs ?? '–'} ms)`)
      if (isSuperAdmin) void shrinkStoredDocs(cached.filter((c) => rows.some((r) => r.member === c.memberId)), privateKey)
    } catch (err) {
      trace(`reveal failed after ${since(t0)} ms:`, err)
      if (!stale()) toast.error(t('idsDecryptFailed'))
    } finally {
      (pdfSession as PdfRasterSession | null)?.close()
      if (!stale()) {
        setProgress(null)
        setBusy(false)
      }
    }
  }, [gameId, roster, privateKey, t, viewerFirstName, viewerLastName, isSuperAdmin])

  const withDocs = useMemo(() => (cards ?? []).filter((c) => !c.missing), [cards])
  const missing = useMemo(() => (cards ?? []).filter((c) => c.missing), [cards])
  const card = withDocs[idx]

  const roleLabel = (role: string | null | undefined) => {
    switch (role) {
      case 'coach': return t('pregameRoleCoach')
      case 'assistant_coach_1': return t('pregameRoleAssistant1')
      case 'assistant_coach_2': return t('pregameRoleAssistant2')
      case 'physio': return t('pregameRolePhysio')
      case 'doctor': return t('pregameRoleDoctor')
      default: return t('pregameRoleStaff')
    }
  }

  return (
    <>
      {loading && <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!loading && (
        <div className="space-y-4">
          {sheetGame && (
            <p className="text-sm font-medium text-foreground">{sheetGame.home_team} – {sheetGame.away_team}</p>
          )}
          {sheetCount && (
            <p className="text-sm font-semibold tabular-nums">
              {t('sheetPlayers', { count: sheetCount.players })}, {t('sheetLiberos', { count: sheetCount.liberos })}
            </p>
          )}
          {!cards && (
            <div className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-sunken p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {kickoffMs != null
                  ? t('idsWindow', { time: fmtOpensAt(kickoffMs - showBeforeMs) })
                  : t('idsNoKickoff')}
              </p>
            </div>
          )}

          {/* Who is on the sheet comes from the one Volleymanager read — flag its problems here. */}
          {!cards && (
            <VmCheckBanner gameId={gameId} check={vmCheck} onRechecked={() => setSheetKey((k) => k + 1)} />
          )}

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
                    className="h-11 flex-1 rounded-lg border border-input bg-card px-3 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20"
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
                  onClick={() => void (async () => {
                    const t0 = performance.now()
                    trace(`show pressed: ${cachedCount} cached${cachedCount === 0 ? ' → downloading first' : ''}`)
                    if (cachedCount === 0) await preload()
                    await reveal()
                    trace(`show total (tap → last ID ready): ${since(t0)} ms`)
                  })()}
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
                  {t('idsLockedUntil', { time: fmtOpensAt(opensAt) })}
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
                  {card.staff ? (ROLE_SHORT[card.role ?? ''] ?? '·') : (card.number ?? '—')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="break-words text-base font-bold uppercase leading-tight">{card.name}</div>
                  <div className="flex gap-1.5 pt-0.5">
                    {card.is_captain && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-secondary-foreground">{t('pregameCaptain')}</span>}
                    {card.is_libero && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-secondary-foreground">{t('pregameLibero')}</span>}
                    {card.official && <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{roleLabel(card.role)}</span>}
                  </div>
                </div>
                <IconButton label={t('idsFullscreen')} variant="outline" className="shrink-0" onClick={() => setFullscreen(true)}>
                  <Maximize2 />
                </IconButton>
              </div>

              {/* Arrows ABOVE the document: the ID fills most of a phone screen, and
                  below it they were off-screen — the coach could not find "next". */}
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

              <div className="relative">
                {card.isPdf ? (
                  <iframe
                    src={card.url ?? ''}
                    title={card.name}
                    className="h-[calc(100dvh-19rem)] min-h-64 w-full rounded-lg border bg-white"
                  />
                ) : (
                  // Always fitted — a stacked multi-page scan too: no scrolling at the
                  // table. Too small to read? Tap for full screen.
                  <img
                    src={card.url ?? ''}
                    alt={card.name}
                    onClick={() => setFullscreen(true)}
                    className="max-h-[calc(100dvh-19rem)] min-h-40 w-full cursor-zoom-in rounded-lg border bg-background object-contain"
                  />
                )}
                {/* Fallback overlay for anything the canvas could not draw (e.g. a PDF pdf.js rejected):
                    weaker than the burned-in mark, but the label is never absent. */}
                {!card.burned && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 grid select-none place-items-center overflow-hidden"
                  >
                    <span className="-rotate-12 whitespace-nowrap text-lg font-bold uppercase tracking-widest text-foreground/20 [text-shadow:0_0_3px_rgba(0,0,0,0.25)]">
                      KSC Wiedikon · Spielkontrolle
                    </span>
                  </div>
                )}
              </div>

              {missing.length > 0 && !progress && (
                <p className="text-xs text-muted-foreground">
                  {t('idsMissing', { count: missing.length, names: missing.map((m) => m.name).join(', ') })}
                </p>
              )}
            </div>
          )}

          {progress && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              {t('idsPreparing', { done: progress.done, total: progress.total })}
            </p>
          )}

          {cards && withDocs.length === 0 && !progress && (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('idsNone')}</p>
          )}
        </div>
      )}

      {/* Full screen: a NESTED dialog, not a plain overlay — Show IDs is itself a Radix
          dialog (a vaul drawer on phones), and anything outside it counts as an outside
          click that closes it. Radix stacks nested dialogs: Escape and outside clicks
          close only this one. Same deck and index, so ← → step through players here too. */}
      <Dialog open={fullscreen && !!card} onOpenChange={setFullscreen}>
        {card && (
          <DialogContent
            hideClose
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1))
              if (e.key === 'ArrowRight') setIdx((i) => Math.min(withDocs.length - 1, i + 1))
            }}
            className="left-0 top-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black p-0 text-white shadow-none sm:p-0"
          >
            <DialogTitle className="sr-only">{card.name}</DialogTitle>
            <DialogDescription className="sr-only">{t('idsTitle')}</DialogDescription>
            <div className="flex items-center gap-3 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
              <span className="min-w-0 flex-1 truncate text-sm font-bold uppercase" title={card.name}>
                {card.staff ? (ROLE_SHORT[card.role ?? ''] ?? '·') : (card.number ?? '—')} · {card.name}
              </span>
              <IconButton label={t('idsCloseFullscreen')} className="shrink-0 text-white hover:bg-white/10 hover:text-white" onClick={() => setFullscreen(false)}>
                <X />
              </IconButton>
            </div>
            <div className="relative min-h-0 flex-1">
              {card.isPdf ? (
                <iframe src={card.url ?? ''} title={card.name} className="h-full w-full bg-white" />
              ) : (
                <img src={card.url ?? ''} alt={card.name} className="h-full w-full object-contain" />
              )}
              {!card.burned && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid select-none place-items-center overflow-hidden">
                  <span className="-rotate-12 whitespace-nowrap text-lg font-bold uppercase tracking-widest text-white/20">
                    KSC Wiedikon · Spielkontrolle
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <IconButton label={t('idsPrev')} className="text-white hover:bg-white/10 hover:text-white" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
                <ChevronLeft />
              </IconButton>
              <span className="flex-1 text-center text-sm tabular-nums text-white/70">
                {idx + 1} / {withDocs.length}
              </span>
              <IconButton label={t('idsNext')} className="text-white hover:bg-white/10 hover:text-white" onClick={() => setIdx((i) => Math.min(withDocs.length - 1, i + 1))} disabled={idx >= withDocs.length - 1}>
                <ChevronRight />
              </IconButton>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
