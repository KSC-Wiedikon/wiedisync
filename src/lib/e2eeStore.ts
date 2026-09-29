/**
 * Where the member's private key lives between page loads.
 *
 * It has to live somewhere. The plaintext password only exists during the login call —
 * every reload restores the session from an httpOnly cookie and has no access to it — so
 * without a device store, a member would be re-typing their password on every refresh, and
 * a coach would be doing it in a gym with no signal.
 *
 * So: IndexedDB, holding a NON-EXTRACTABLE CryptoKey. The browser's key store keeps the raw
 * bytes out of JavaScript's reach entirely — script (including an XSS) can ask the key to
 * decrypt, but cannot read the key out and send it anywhere. That is the same trade every
 * E2EE messenger makes: the key lives on your device, and losing the device is the risk you
 * accept in exchange for not re-deriving from a password you don't have.
 *
 * Keyed by member id, so a shared family device (siblings on one phone — which this club
 * genuinely has) keeps its keys apart.
 */

const DB_NAME = 'kscw-e2ee'
const DB_VERSION = 3
const STORE = 'device-keys'
const DOCS = 'cached-docs'
/** v3 (2026-09-29): the match sheet saved next to a game's documents — see CachedSheet. */
const SHEETS = 'cached-sheets'

export interface DeviceKey {
  memberId: number
  privateKey: CryptoKey
  /** members.e2ee_key_created — lets us notice the server has a DIFFERENT keypair now. */
  keyCreated: string
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'memberId' })
      if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SHEETS)) db.createObjectStore(SHEETS, { keyPath: 'gameId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close()))
}

export async function saveDeviceKey(key: DeviceKey): Promise<void> {
  await tx(STORE, 'readwrite', (s) => s.put(key))
}

/**
 * The key this device holds, if any. `keyCreated` must be checked against the server's
 * members.e2ee_key_created by the caller: if they differ, the member re-keyed elsewhere
 * (a password reset), this key is dead, and everything wrapped to it is unreadable.
 */
export async function loadDeviceKey(memberId: number): Promise<DeviceKey | null> {
  try {
    return (await tx<DeviceKey | undefined>(STORE, 'readonly', (s) => s.get(memberId))) ?? null
  } catch {
    // A private-mode browser or a blocked IndexedDB is not an error worth surfacing — it
    // just means this device cannot remember, and the member unlocks again.
    return null
  }
}

export async function clearDeviceKey(memberId: number): Promise<void> {
  try {
    await tx(STORE, 'readwrite', (s) => s.delete(memberId))
  } catch {
    // Nothing to do — if we cannot open the store there is no key in it either.
  }
}

// ── pre-loaded documents ──────────────────────────────────────────────────────
//
// Halls have no signal. A coach who only fetched at kickoff would be standing in a
// basement in front of a referee with a spinner. So they pre-load while they still have
// bars, and what lands on the phone is CIPHERTEXT plus a wrapped key — never plaintext.
// The document is decrypted on demand, in memory, and the device key that opens it is
// non-extractable. A lost phone leaks nothing.

export interface CachedDoc {
  /** `${gameId}:${memberId}` */
  id: string
  gameId: string
  memberId: number
  ciphertext: ArrayBuffer
  iv: string
  mime: string | null
  envelope: { eph_public_key: string; wrap_iv: string; wrapped_key: string }
  cachedAt: number
}

export async function cacheDocument(doc: Omit<CachedDoc, 'id' | 'cachedAt'>): Promise<void> {
  await tx(DOCS, 'readwrite', (s) => s.put({
    ...doc,
    id: `${doc.gameId}:${doc.memberId}`,
    cachedAt: Date.now(),
  }))
}

export async function loadCachedDocuments(gameId: string): Promise<CachedDoc[]> {
  try {
    const all = await tx<CachedDoc[]>(DOCS, 'readonly', (s) => s.getAll())
    return all.filter((d) => d.gameId === gameId)
  } catch {
    return []
  }
}

/**
 * True when ANY cached identity document on this device is a PDF — the app-boot
 * hook uses it to decide whether pdf.js must be warmed for offline rendering.
 * Walks a cursor over the store and only looks at `mime`.
 */
export async function hasCachedPdfDocuments(): Promise<boolean> {
  try {
    const db = await open()
    return await new Promise<boolean>((resolve) => {
      const req = db.transaction(DOCS, 'readonly').objectStore(DOCS).openCursor()
      req.onsuccess = () => {
        const cur = req.result
        if (!cur) return resolve(false)
        if ((cur.value as CachedDoc).mime === 'application/pdf') return resolve(true)
        cur.continue()
      }
      req.onerror = () => resolve(false)
    }).finally(() => db.close())
  } catch {
    return false
  }
}

// ── the match sheet, saved next to the documents ─────────────────────────────
//
// Show IDs learns WHO to show from the match sheet, which comes from the server. At a hall
// with no signal that request fails, and the downloaded documents had no names or order to
// go with them — the deck came up empty. So the sheet is saved here with the documents and
// used when the server cannot be reached. Only what the deck displays: member id, number,
// last name + initial, captain / libero, staff role. Never a birthdate (the sheet endpoint
// sends them; the caller picks fields explicitly). Wiped with the documents.

export interface CachedSheetRow {
  member: number
  number: number | null
  last_name: string
  first_initial: string
  is_captain: boolean
  is_libero: boolean
  staff: boolean
  official: boolean
  role: string | null
}

export interface CachedSheet {
  gameId: string
  game: { home_team: string; away_team: string; date: string; time: string | null }
  rows: CachedSheetRow[]
  /** Head count of the sheet (unlinked players included) and its liberos. */
  players: number
  liberos: number
  cachedAt: number
}

export async function cacheSheet(sheet: Omit<CachedSheet, 'cachedAt'>): Promise<void> {
  try {
    await tx(SHEETS, 'readwrite', (s) => s.put({ ...sheet, cachedAt: Date.now() }))
  } catch {
    // Best effort — without it the deck just needs signal, as before.
  }
}

export async function loadCachedSheet(gameId: string): Promise<CachedSheet | null> {
  try {
    return (await tx<CachedSheet | undefined>(SHEETS, 'readonly', (s) => s.get(gameId))) ?? null
  } catch {
    return null
  }
}

/**
 * Drop everything cached for a game — documents and the saved sheet. Called once the
 * display window closes, so a squad's identity documents do not sit on a coach's phone
 * until the end of the season.
 */
export async function clearCachedDocuments(gameId: string): Promise<void> {
  try {
    const all = await tx<CachedDoc[]>(DOCS, 'readonly', (s) => s.getAll())
    for (const d of all.filter((x) => x.gameId === gameId)) {
      await tx(DOCS, 'readwrite', (s) => s.delete(d.id))
    }
    await tx(SHEETS, 'readwrite', (s) => s.delete(gameId))
  } catch {
    // Best effort.
  }
}

/**
 * Drop EVERY cached document, whatever game it belongs to.
 *
 * The per-game helper above cannot be called without already knowing the game
 * ids, and its only caller fires from a mounted `ShowIdsView` once the display
 * window closes — so closing the modal, or the tab, before kickoff stranded a
 * squad's identity documents permanently (audit 2026-08-08, finding 15).
 *
 * That mattered because the two object stores are complementary: the device key
 * is imported with `deriveKey`/`deriveBits`, exactly what `unwrapContentKey`
 * needs, so key + ciphertext together yield plaintext government-ID scans
 * offline, same origin, no cookie. Non-extractability protects the key from
 * being *exfiltrated*, not from being *used* by whoever sits down next at a
 * shared club laptop. Logout now clears both, which is what
 * `e2eeStore`'s own "a lost phone leaks nothing" promise requires.
 */
export async function clearAllCachedDocuments(): Promise<void> {
  try {
    await tx(DOCS, 'readwrite', (s) => s.clear())
    await tx(SHEETS, 'readwrite', (s) => s.clear())
  } catch {
    // Best effort — logout must never fail because a wipe did.
  }
}
