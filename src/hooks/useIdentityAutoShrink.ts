import { useEffect } from 'react'
import { useAuth } from './useAuth'
import { API_URL, getActingMemberId, kscwApi } from '../lib/api'
import { decryptDocument, unwrapContentKey, type Envelope } from '../lib/e2ee'
import { loadDeviceKey } from '../lib/e2eeStore'
import { needsShrink, shrinkIdDocument } from '../lib/idShrink'
import { storeIdentityDocument } from '../lib/identityUpload'

interface DocMeta {
  data: { iv: string; mime: string | null; size: number | null; envelope: Envelope }
}

const FLAG = (memberId: number) => `kscw:id-shrink:${memberId}`
const RETRY_MS = 24 * 60 * 60 * 1000

function readFlag(memberId: number): string | null {
  try { return localStorage.getItem(FLAG(memberId)) } catch { return null }
}
function writeFlag(memberId: number, value: string): void {
  try { localStorage.setItem(FLAG(memberId), value) } catch { /* private mode: we just check again */ }
}

/**
 * Re-encode the member's OWN stored identity document at WhatsApp size, once.
 *
 * Documents uploaded before 2026-09-29 are 1–2.5 MB camera crops, or PDFs that need pdf.js
 * at the hall. The server never sees the plaintext, so only a device holding a key can
 * shrink one — and the owner's own app is the one that may replace it without widening who
 * can read it (`recompress`, identityUpload.ts).
 *
 * Local-first: nothing is requested unless THIS device holds the member's key, and a
 * finished check is remembered per device. Never throws, never toasts — the member sees
 * nothing; a failure retries a day later.
 */
async function shrinkOwnIdentityDocument(memberId: number, cancelled: () => boolean): Promise<void> {
  const flag = readFlag(memberId)
  if (flag === 'done' || (flag != null && Number(flag) > Date.now())) return
  // Acting for a household member would send their id with every call; keys follow the
  // session owner, so leave it for a session that is not acting.
  if (navigator.onLine === false || getActingMemberId() != null) return
  const device = await loadDeviceKey(memberId)
  if (!device || cancelled()) return

  const t0 = performance.now()
  try {
    let meta: DocMeta
    try {
      meta = await kscwApi<DocMeta>(`/identity/document/${memberId}`)
    } catch (err) {
      // No document: a future upload is shrunk at upload time — nothing left to do here.
      writeFlag(memberId, (err as { code?: string }).code === 'no_document' ? 'done' : String(Date.now() + RETRY_MS))
      return
    }
    const { iv, mime, size, envelope } = meta.data
    if (!needsShrink(size, mime)) { writeFlag(memberId, 'done'); return }

    const res = await fetch(`${API_URL}/kscw/identity/document/${memberId}/bytes`, { credentials: 'include' })
    if (!res.ok) throw new Error(`bytes ${res.status}`)
    const key = await unwrapContentKey(envelope, device.privateKey)
    const plain = await decryptDocument(new Uint8Array(await res.arrayBuffer()), iv, key)
    const small = await shrinkIdDocument(plain, mime ?? 'image/jpeg')
    // Not decodable here (an iPhone HEIC on Android) or not actually smaller: another of
    // the member's devices may do better — try again tomorrow.
    if (!small || (mime !== 'application/pdf' && small.size >= plain.byteLength)) {
      writeFlag(memberId, String(Date.now() + RETRY_MS))
      return
    }
    if (cancelled()) return
    await storeIdentityDocument({ member: memberId, file: small, mime: 'image/jpeg', recompress: true })
    writeFlag(memberId, 'done')
    console.info('[ids]', `own document shrunk: ${mime} ${Math.round(plain.byteLength / 1024)} KB → ${Math.round(small.size / 1024)} KB in ${Math.round(performance.now() - t0)} ms`)
  } catch (err) {
    console.info('[ids]', 'own document shrink failed, retrying tomorrow:', err)
    writeFlag(memberId, String(Date.now() + RETRY_MS))
  }
}

/** Mounted once in the app shell. Waits for the app to settle before doing anything. */
export function useIdentityAutoShrink(): void {
  const { realUser } = useAuth()
  const memberId = realUser?.id ? Number(realUser.id) : null
  useEffect(() => {
    if (memberId == null) return
    let stopped = false
    const timer = setTimeout(() => { void shrinkOwnIdentityDocument(memberId, () => stopped) }, 20_000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [memberId])
}
