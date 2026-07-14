/**
 * End-to-end encryption for identity documents.
 *
 * The club must not be able to read these — not the server, not an admin, not whoever has
 * root on the VPS. So no key ever reaches us. Everything here runs in the member's browser.
 *
 * The shape (standard hybrid/envelope encryption):
 *
 *   document  --AES-256-GCM--> ciphertext        (random content key, one per document)
 *   contentKey --ECDH+HKDF+AES-GCM--> envelope   (one per person allowed to read it)
 *   privateKey --PBKDF2(password)+AES-GCM--> blob (so a new device can bootstrap)
 *
 * Wrapping only needs the recipient's PUBLIC key, which is why an admin can upload a
 * document *for* a member and be unable to read it afterwards: they simply never wrap an
 * envelope to themselves.
 *
 * The private key is held on the device (IndexedDB, see e2eeStore.ts) because the plaintext
 * password only exists during the login call — a page reload restores the session from an
 * httpOnly cookie and has no access to it.
 */

const KDF_ITERATIONS = 600_000 // OWASP floor for PBKDF2-SHA256 (2023+)
const CURVE = 'P-256' // WebCrypto's only universally supported ECDH curve
const HKDF_INFO = 'kscw-identity-document-v1'

export interface KeyMaterial {
  /** SPKI, base64. Public by design — others wrap to it. */
  publicKey: string
  /** PKCS8 encrypted under PBKDF2(password), base64. Opaque to the server. */
  privateKey: string
  /** PBKDF2 salt, base64. Not a secret. */
  salt: string
}

/** One wrapped content key: what an authorised reader needs, and nobody else can use. */
export interface Envelope {
  eph_public_key: string
  wrap_iv: string
  wrapped_key: string
}

export interface EncryptedDocument {
  ciphertext: Uint8Array
  iv: string
  /** Kept in memory only — this is the secret the envelopes protect. */
  contentKey: CryptoKey
}

// ── base64 ────────────────────────────────────────────────────────────────────

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  // Chunked: String.fromCharCode(...bytes) blows the call stack on a multi-MB photo.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

const unb64 = (s: string): Uint8Array => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n))

// ── the member's keypair ──────────────────────────────────────────────────────

/** Derive the key that protects the private key, from the member's login password. */
async function passwordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Create a fresh keypair and wrap the private half under the password.
 *
 * A new keypair ORPHANS every envelope previously wrapped to the old public key — which is
 * exactly why a forgotten password means "upload your ID again" rather than "we restore it
 * for you". There is no escrow. That is the feature, not a gap.
 */
export async function createKeyMaterial(
  password: string,
): Promise<{ material: KeyMaterial; deviceKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE }, true, ['deriveKey', 'deriveBits'],
  ) as CryptoKeyPair

  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    await passwordKey(password, salt),
    pkcs8,
  )

  // Hand back a NON-extractable copy for the device store — script can ask it to decrypt but
  // cannot read the key out and send it anywhere. The extractable original goes out of scope
  // here and is never persisted.
  //
  // Re-importing (rather than making the caller unwrapPrivateKey() again) is not just tidier:
  // it saves a second 600k-iteration PBKDF2, which is what makes it cheap enough to do
  // silently during login instead of behind a "create key" button.
  const deviceKey = await crypto.subtle.importKey(
    'pkcs8', pkcs8, { name: 'ECDH', namedCurve: CURVE }, false, ['deriveKey', 'deriveBits'],
  )

  return {
    material: {
      publicKey: b64(await crypto.subtle.exportKey('spki', pair.publicKey)),
      // iv is prepended — it is public, and keeping it next to its ciphertext is what stops
      // the two drifting apart in the DB.
      privateKey: b64(new Uint8Array([...iv, ...new Uint8Array(wrapped)])),
      salt: b64(salt),
    },
    deviceKey,
  }
}

/**
 * Unwrap the private key with the password. Throws if the password is wrong — AES-GCM's
 * auth tag fails rather than yielding garbage, so a bad password is unambiguous.
 */
export async function unwrapPrivateKey(
  material: Pick<KeyMaterial, 'privateKey' | 'salt'>,
  password: string,
  extractable = false,
): Promise<CryptoKey> {
  const blob = unb64(material.privateKey)
  const iv = blob.subarray(0, 12)
  const body = blob.subarray(12)
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    await passwordKey(password, unb64(material.salt)),
    body as BufferSource,
  )
  return crypto.subtle.importKey(
    'pkcs8', pkcs8, { name: 'ECDH', namedCurve: CURVE }, extractable, ['deriveKey', 'deriveBits'],
  )
}

/**
 * Re-wrap the private key under a new password, keeping the SAME keypair — so every envelope
 * ever wrapped to this member stays valid, and their coaches keep their access.
 *
 * Needs BOTH plaintexts at once, which is exactly why `POST /kscw/change-password` verifies
 * the current password: none of the four pre-existing password paths ever holds the old one,
 * so all of them silently orphan the key.
 */
export async function rewrapPrivateKey(
  material: KeyMaterial,
  currentPassword: string,
  newPassword: string,
): Promise<KeyMaterial> {
  const priv = await unwrapPrivateKey(material, currentPassword, true)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    await passwordKey(newPassword, salt),
    await crypto.subtle.exportKey('pkcs8', priv),
  )
  return {
    publicKey: material.publicKey,
    privateKey: b64(new Uint8Array([...iv, ...new Uint8Array(wrapped)])),
    salt: b64(salt),
  }
}

// ── the document ──────────────────────────────────────────────────────────────

/** Encrypt a file in the browser. The plaintext never leaves this function's caller. */
export async function encryptDocument(file: Blob): Promise<EncryptedDocument> {
  const contentKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  )
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    contentKey,
    await file.arrayBuffer(),
  )
  return { ciphertext: new Uint8Array(ct), iv: b64(iv), contentKey }
}

/**
 * Decrypt. A truncated or corrupted file fails the GCM auth tag LOUDLY rather than
 * yielding garbage — which matters here, because the file-integrity checker inspects magic
 * bytes and ciphertext has none, so this tag is the only thing standing between us and the
 * silent-truncation class of bug that destroyed 36 ID scans in June.
 */
export async function decryptDocument(
  ciphertext: Uint8Array,
  iv: string,
  contentKey: CryptoKey,
): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv) as BufferSource },
    contentKey,
    ciphertext as BufferSource,
  )
  return new Uint8Array(plain)
}

// ── the envelopes ─────────────────────────────────────────────────────────────

/** ECDH → HKDF → the AES key that wraps a content key for exactly one recipient. */
async function wrappingKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

const importPublic = (spki: string) => crypto.subtle.importKey(
  'spki', unb64(spki) as BufferSource, { name: 'ECDH', namedCurve: CURVE }, true, [],
)

/**
 * Wrap the content key FOR one recipient, using only their public key.
 *
 * This is what lets an admin upload a member's ID and be unable to read it back: they can
 * wrap to the member and to the coaches without ever holding a private key, and they simply
 * do not wrap one to themselves.
 */
export async function wrapContentKeyFor(
  contentKey: CryptoKey,
  recipientPublicKey: string,
): Promise<Envelope> {
  // Ephemeral-static ECDH: a throwaway keypair per envelope, so the same content key wrapped
  // to two people shares no derived secret.
  const eph = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE }, true, ['deriveKey', 'deriveBits'],
  ) as CryptoKeyPair

  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const kek = await wrappingKey(eph.privateKey, await importPublic(recipientPublicKey), salt)
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    kek,
    await crypto.subtle.exportKey('raw', contentKey),
  )

  return {
    eph_public_key: b64(await crypto.subtle.exportKey('spki', eph.publicKey)),
    // The HKDF salt rides with the iv — both are public, and both are useless apart.
    wrap_iv: b64(new Uint8Array([...salt, ...iv])),
    wrapped_key: b64(new Uint8Array(wrapped)),
  }
}

/** Open an envelope addressed to me. Throws if it was not (GCM auth tag). */
export async function unwrapContentKey(env: Envelope, myPrivateKey: CryptoKey): Promise<CryptoKey> {
  const saltIv = unb64(env.wrap_iv)
  const kek = await wrappingKey(
    myPrivateKey,
    await importPublic(env.eph_public_key),
    saltIv.subarray(0, 16),
  )
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: saltIv.subarray(16) as BufferSource },
    kek,
    unb64(env.wrapped_key) as BufferSource,
  )
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}
