// The offline Show IDs cache is ciphertext + wrapped keys, but the device key that
// opens it sits in the same IndexedDB — so how long it lives is the exposure. It
// outlived its game (only wiped if that game's view was reopened after kickoff) and
// the session, and a different member logging in inherited it (security audit
// 2026-10, M4). Every entry now carries an owner and an expiry; these pin the sweep.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CACHE_FALLBACK_TTL_MS, cacheDocument, cacheExpiry, cacheSheet, clearAllCachedDocuments,
  isStaleCacheEntry, loadCachedDocuments, loadCachedSheet, sweepCachedDocuments,
} from './e2eeStore'

describe('cacheExpiry', () => {
  it('is the window end when the caller knows it', () => {
    expect(cacheExpiry(5_000, 1_000)).toBe(5_000)
  })

  it('falls back to the longest the server allows before kickoff', () => {
    expect(cacheExpiry(null, 1_000)).toBe(1_000 + CACHE_FALLBACK_TTL_MS)
    expect(cacheExpiry(Number.NaN, 1_000)).toBe(1_000 + CACHE_FALLBACK_TTL_MS)
  })
})

describe('isStaleCacheEntry', () => {
  const now = 10_000_000

  it('drops what is past its window, keeps what is not', () => {
    expect(isStaleCacheEntry({ owner: 1, expiresAt: now - 1 }, now)).toBe(true)
    expect(isStaleCacheEntry({ owner: 1, expiresAt: now + 1 }, now)).toBe(false)
  })

  it('drops what another member downloaded once the owner is known', () => {
    expect(isStaleCacheEntry({ owner: 2, expiresAt: now + 1 }, now, 1)).toBe(true)
    expect(isStaleCacheEntry({ owner: 1, expiresAt: now + 1 }, now, 1)).toBe(false)
  })

  it('treats entries from before owner/expiry existed as foreign, expiring on the fallback', () => {
    expect(isStaleCacheEntry({ cachedAt: now - 60_000 }, now)).toBe(false)
    expect(isStaleCacheEntry({ cachedAt: now - CACHE_FALLBACK_TTL_MS - 1 }, now)).toBe(true)
    expect(isStaleCacheEntry({ cachedAt: now - 60_000 }, now, 1)).toBe(true)
  })
})

// A minimal in-memory IndexedDB — just the calls e2eeStore makes.
function fakeIndexedDB() {
  const dbs = new Map<string, Map<string, { keyPath: string; rows: Map<unknown, unknown> }>>()
  const request = <T>(fn: () => T) => {
    const r: { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {}
    queueMicrotask(() => {
      try { r.result = fn(); r.onsuccess?.() } catch (e) { r.error = e; r.onerror?.() }
    })
    return r
  }
  return {
    dbs,
    open(name: string) {
      const r: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = {}
      queueMicrotask(() => {
        const fresh = !dbs.has(name)
        if (fresh) dbs.set(name, new Map())
        const stores = dbs.get(name)!
        r.result = {
          objectStoreNames: { contains: (n: string) => stores.has(n) },
          createObjectStore: (n: string, o: { keyPath: string }) => { stores.set(n, { keyPath: o.keyPath, rows: new Map() }) },
          transaction: (n: string) => ({
            objectStore: () => {
              const s = stores.get(n)!
              return {
                put: (v: Record<string, unknown>) => request(() => { s.rows.set(v[s.keyPath], v) }),
                get: (k: unknown) => request(() => s.rows.get(k)),
                getAll: () => request(() => [...s.rows.values()]),
                delete: (k: unknown) => request(() => { s.rows.delete(k) }),
                clear: () => request(() => { s.rows.clear() }),
              }
            },
          }),
          close() {},
        }
        if (fresh) r.onupgradeneeded?.()
        r.onsuccess?.()
      })
      return r
    },
  }
}

describe('sweepCachedDocuments', () => {
  const doc = (memberId: number, owner: number, windowEndMs: number | null) => cacheDocument({
    gameId: 'g1', memberId, owner, windowEndMs,
    ciphertext: new ArrayBuffer(4), iv: 'iv', mime: 'image/jpeg',
    envelope: { eph_public_key: 'e', wrap_iv: 'w', wrapped_key: 'k' },
  })
  const sheet = (gameId: string, owner: number, windowEndMs: number | null) => cacheSheet({
    gameId, owner, windowEndMs, game: { home_team: 'A', away_team: 'B', date: '2026-10-11', time: '18:00' },
    rows: [], players: 0, liberos: 0,
  })
  let idb: ReturnType<typeof fakeIndexedDB>

  beforeEach(() => {
    idb = fakeIndexedDB()
    vi.stubGlobal('indexedDB', idb)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('at boot (no owner) drops only what is past its window', async () => {
    const later = Date.now() + 60 * 60 * 1000
    await doc(1, 7, later)
    await doc(2, 7, Date.now() - 1000)
    await sheet('g1', 7, later)
    await sheet('g2', 7, Date.now() - 1000)
    await sweepCachedDocuments()
    expect((await loadCachedDocuments('g1')).map((d) => d.memberId)).toEqual([1])
    expect(await loadCachedSheet('g1')).not.toBeNull()
    expect(await loadCachedSheet('g2')).toBeNull()
  })

  it('when a member is established, drops what another member downloaded', async () => {
    const later = Date.now() + 60 * 60 * 1000
    await doc(1, 7, later)
    await doc(2, 8, later)
    await sheet('g1', 8, later)
    await sweepCachedDocuments(7)
    expect((await loadCachedDocuments('g1')).map((d) => d.memberId)).toEqual([1])
    expect(await loadCachedSheet('g1')).toBeNull()
  })

  it('records owner and expiry on every write', async () => {
    const end = Date.now() + 1234
    await doc(1, 7, end)
    const [d] = await loadCachedDocuments('g1')
    expect(d).toMatchObject({ owner: 7, expiresAt: end })
    expect(d).not.toHaveProperty('windowEndMs')
  })

  it('clearAllCachedDocuments empties both stores', async () => {
    await doc(1, 7, null)
    await sheet('g1', 7, null)
    await clearAllCachedDocuments()
    expect(await loadCachedDocuments('g1')).toEqual([])
    expect(await loadCachedSheet('g1')).toBeNull()
  })

  it('never throws without IndexedDB (private mode, node)', async () => {
    vi.unstubAllGlobals()
    await expect(sweepCachedDocuments(1)).resolves.toBeUndefined()
  })
})
