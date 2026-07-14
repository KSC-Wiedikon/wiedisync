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
const DB_VERSION = 1
const STORE = 'device-keys'

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
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close()))
}

export async function saveDeviceKey(key: DeviceKey): Promise<void> {
  await tx('readwrite', (s) => s.put(key))
}

/**
 * The key this device holds, if any. `keyCreated` must be checked against the server's
 * members.e2ee_key_created by the caller: if they differ, the member re-keyed elsewhere
 * (a password reset), this key is dead, and everything wrapped to it is unreadable.
 */
export async function loadDeviceKey(memberId: number): Promise<DeviceKey | null> {
  try {
    return (await tx<DeviceKey | undefined>('readonly', (s) => s.get(memberId))) ?? null
  } catch {
    // A private-mode browser or a blocked IndexedDB is not an error worth surfacing — it
    // just means this device cannot remember, and the member unlocks again.
    return null
  }
}

export async function clearDeviceKey(memberId: number): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(memberId))
  } catch {
    // Nothing to do — if we cannot open the store there is no key in it either.
  }
}
