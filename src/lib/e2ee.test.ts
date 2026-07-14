import { describe, expect, it } from 'vitest'
import {
  createKeyMaterial,
  decryptDocument,
  encryptDocument,
  rewrapPrivateKey,
  unwrapContentKey,
  unwrapPrivateKey,
  wrapContentKeyFor,
} from './e2ee'

const PW = 'correct horse battery staple'
const doc = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5])]) // JPEG-ish

describe('e2ee', () => {
  it('round-trips a document for its owner', async () => {
    const { material } = await createKeyMaterial(PW)
    const priv = await unwrapPrivateKey(material, PW)

    const enc = await encryptDocument(doc())
    const env = await wrapContentKeyFor(enc.contentKey, material.publicKey)

    const key = await unwrapContentKey(env, priv)
    const plain = await decryptDocument(enc.ciphertext, enc.iv, key)

    expect([...plain]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5])
  })

  it('the ciphertext does not contain the plaintext', async () => {
    const enc = await encryptDocument(doc())
    // The magic bytes must not survive — if they did, the file-integrity checker would be
    // able to read the type, and so would anyone else.
    expect([...enc.ciphertext].slice(0, 4)).not.toEqual([0xff, 0xd8, 0xff, 0xe0])
  })

  it('a wrong password cannot unwrap the private key', async () => {
    const { material } = await createKeyMaterial(PW)
    await expect(unwrapPrivateKey(material, 'wrong password')).rejects.toThrow()
  })

  it('someone else cannot open an envelope that is not theirs', async () => {
    const { material: mine } = await createKeyMaterial(PW)
    const { material: theirs } = await createKeyMaterial('another password')
    const theirPriv = await unwrapPrivateKey(theirs, 'another password')

    const enc = await encryptDocument(doc())
    const envForMe = await wrapContentKeyFor(enc.contentKey, mine.publicKey)

    // This is the whole security claim: a coach who was never wrapped to — or the server,
    // or an admin — holds ciphertext and a locked envelope, and gets nothing from either.
    await expect(unwrapContentKey(envForMe, theirPriv)).rejects.toThrow()
  })

  it('wraps the same document to several readers independently', async () => {
    const { material: member } = await createKeyMaterial(PW)
    const { material: coach } = await createKeyMaterial('coach password')

    const enc = await encryptDocument(doc())
    const envMember = await wrapContentKeyFor(enc.contentKey, member.publicKey)
    const envCoach = await wrapContentKeyFor(enc.contentKey, coach.publicKey)

    // Ephemeral-static ECDH: two envelopes for the same content key must share nothing.
    expect(envMember.eph_public_key).not.toEqual(envCoach.eph_public_key)
    expect(envMember.wrapped_key).not.toEqual(envCoach.wrapped_key)

    for (const [material, pw, env] of [
      [member, PW, envMember],
      [coach, 'coach password', envCoach],
    ] as const) {
      const priv = await unwrapPrivateKey(material, pw)
      const key = await unwrapContentKey(env, priv)
      expect([...(await decryptDocument(enc.ciphertext, enc.iv, key))]).toEqual(
        [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5],
      )
    }
  })

  it('a password change keeps the keypair, so existing envelopes still open', async () => {
    const { material } = await createKeyMaterial(PW)

    // A coach was wrapped to this member's key BEFORE the password change.
    const enc = await encryptDocument(doc())
    const env = await wrapContentKeyFor(enc.contentKey, material.publicKey)

    const rewrapped = await rewrapPrivateKey(material, PW, 'a brand new password')

    // Same public key → every envelope ever addressed to them survives. This is what
    // /kscw/change-password buys: without it, a coach changing their password would lose
    // the key to every player's ID in their squad.
    expect(rewrapped.publicKey).toEqual(material.publicKey)
    expect(rewrapped.privateKey).not.toEqual(material.privateKey) // but rewrapped under the new one

    const priv = await unwrapPrivateKey(rewrapped, 'a brand new password')
    const key = await unwrapContentKey(env, priv)
    expect([...(await decryptDocument(enc.ciphertext, enc.iv, key))]).toEqual(
      [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5],
    )

    // ...and the OLD password is now dead.
    await expect(unwrapPrivateKey(rewrapped, PW)).rejects.toThrow()
  })

  it('the device key cannot be exported, only used', async () => {
    const { material, deviceKey } = await createKeyMaterial(PW)

    // This is what the device store relies on: the browser's key store will let script ASK
    // the key to decrypt, but will not hand the bytes back. An XSS can use it while the tab
    // is open; it cannot steal it and send it anywhere.
    expect(deviceKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('pkcs8', deviceKey)).rejects.toThrow()

    // ...and it is genuinely the right key, not merely an unusable one.
    const enc = await encryptDocument(doc())
    const env = await wrapContentKeyFor(enc.contentKey, material.publicKey)
    const key = await unwrapContentKey(env, deviceKey)
    expect([...(await decryptDocument(enc.ciphertext, enc.iv, key))]).toEqual(
      [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5],
    )
  })

  it('a corrupted or truncated document fails loudly, not silently', async () => {
    const { material } = await createKeyMaterial(PW)
    const priv = await unwrapPrivateKey(material, PW)
    const enc = await encryptDocument(doc())
    const env = await wrapContentKeyFor(enc.contentKey, material.publicKey)
    const key = await unwrapContentKey(env, priv)

    // Ciphertext has no magic bytes, so the file-integrity checker is blind to it. The GCM
    // auth tag is the only thing standing between us and the silent-truncation bug that
    // destroyed 36 ID scans in June — so it had better throw.
    await expect(decryptDocument(enc.ciphertext.slice(0, -1), enc.iv, key)).rejects.toThrow()

    const flipped = new Uint8Array(enc.ciphertext)
    flipped[2] ^= 0x01
    await expect(decryptDocument(flipped, enc.iv, key)).rejects.toThrow()
  })
})
