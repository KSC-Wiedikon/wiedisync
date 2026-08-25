import { describe, it, expect } from 'vitest'
import { encryptDocument, decryptDocument, wrapContentKeyFor, unwrapContentKey } from '../e2ee'

/**
 * The re-grant path, end to end.
 *
 * This is the one thing about "restore access" that cannot be verified by reading it: a
 * re-wrapped envelope either yields the SAME content key or it yields plausible-looking
 * garbage that fails at a hall, in front of a referee, months later. So the assertion is
 * not "no exception" — it is that the newly-granted reader decrypts the ORIGINAL bytes.
 */
async function keypair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']) as Promise<CryptoKeyPair>
}
const spki = async (k: CryptoKey) =>
  btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', k))))

describe('identity document re-grant', () => {
  it('lets a newly-granted reader decrypt the original document', async () => {
    const plaintext = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const enc = await encryptDocument(new Blob([plaintext]))

    // Upload time: wrapped for the holder only. The new coach has no key yet.
    const holder = await keypair()
    const holderEnv = await wrapContentKeyFor(enc.contentKey, await spki(holder.publicKey))

    // Repair time: the holder's device unwraps and re-wraps for the newcomer. At no point
    // does the server see the content key — this whole test runs without one.
    const recovered = await unwrapContentKey(holderEnv, holder.privateKey)
    const newcomer = await keypair()
    const newcomerEnv = await wrapContentKeyFor(recovered, await spki(newcomer.publicKey))

    const theirKey = await unwrapContentKey(newcomerEnv, newcomer.privateKey)
    const out = await decryptDocument(enc.ciphertext, enc.iv, theirKey)
    expect(Array.from(out)).toEqual(Array.from(plaintext))
  })

  it('does not let an unrelated keypair open a re-granted envelope', async () => {
    const enc = await encryptDocument(new Blob([new Uint8Array([9, 8, 7])]))
    const holder = await keypair()
    const holderEnv = await wrapContentKeyFor(enc.contentKey, await spki(holder.publicKey))
    const recovered = await unwrapContentKey(holderEnv, holder.privateKey)

    const newcomer = await keypair()
    const stranger = await keypair()
    const newcomerEnv = await wrapContentKeyFor(recovered, await spki(newcomer.publicKey))

    // The GCM auth tag is what refuses, so this is a rejection and not silent garbage.
    await expect(unwrapContentKey(newcomerEnv, stranger.privateKey)).rejects.toThrow()
  })

  it('survives a second re-grant hop (repair of an already-repaired document)', async () => {
    const plaintext = new Uint8Array([1, 1, 2, 3, 5, 8, 13])
    const enc = await encryptDocument(new Blob([plaintext]))
    const a = await keypair(); const b = await keypair(); const c = await keypair()

    const envA = await wrapContentKeyFor(enc.contentKey, await spki(a.publicKey))
    const keyA = await unwrapContentKey(envA, a.privateKey)
    const envB = await wrapContentKeyFor(keyA, await spki(b.publicKey))
    // B — themselves only ever a re-grant recipient — now repairs for C.
    const keyB = await unwrapContentKey(envB, b.privateKey)
    const envC = await wrapContentKeyFor(keyB, await spki(c.publicKey))

    const out = await decryptDocument(enc.ciphertext, enc.iv, await unwrapContentKey(envC, c.privateKey))
    expect(Array.from(out)).toEqual(Array.from(plaintext))
  })
})
