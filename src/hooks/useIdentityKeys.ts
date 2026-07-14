import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { kscwApi } from '../lib/api'
import { createKeyMaterial, unwrapPrivateKey, type KeyMaterial } from '../lib/e2ee'
import { clearDeviceKey, loadDeviceKey, saveDeviceKey } from '../lib/e2eeStore'

interface KeysResponse {
  data:
    | { has_keys: false }
    | { has_keys: true; public_key: string; private_key: string; salt: string; key_created: string }
}

/**
 * `none`     — no keypair yet; the member has never set one up.
 * `locked`   — a keypair exists on the server, but this device does not hold it. Needs the password.
 * `unlocked` — the private key is in hand (from IndexedDB, or just unlocked/created).
 */
export type KeyState = 'loading' | 'none' | 'locked' | 'unlocked' | 'error'

/**
 * The member's end-to-end encryption key.
 *
 * The password is only ever in memory during the login call — a page reload restores the
 * session from an httpOnly cookie and has no access to it — so the unwrapped key is cached
 * on the device (IndexedDB, non-extractable) and the password is asked for only when this
 * device has never seen the key before.
 *
 * Keyed on `realUser`, NOT `user`: while a superadmin is impersonating someone, `user` is the
 * impersonated member, and deriving key material from them would write one person's key under
 * another person's id. Encryption keys follow the session owner, never the effective identity.
 */
export function useIdentityKeys() {
  const { realUser } = useAuth()
  const memberId = realUser?.id ? Number(realUser.id) : null

  const [state, setState] = useState<KeyState>('loading')
  const [material, setMaterial] = useState<KeyMaterial | null>(null)
  const [keyCreated, setKeyCreated] = useState<string | null>(null)
  const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null)

  useEffect(() => {
    // No synchronous setState here — the initial state is already `loading`, and writing it
    // in the effect body cascades a render.
    if (memberId == null) return
    let cancelled = false

    kscwApi<KeysResponse>('/identity/keys')
      .then(async (res) => {
        if (cancelled) return
        const d = res.data
        if (!d.has_keys) {
          setState('none')
          return
        }
        setMaterial({ publicKey: d.public_key, privateKey: d.private_key, salt: d.salt })
        setKeyCreated(d.key_created)

        // Does this device already hold the key — and is it still the CURRENT one? A member
        // who re-keyed elsewhere (password reset) leaves a stale key behind here that would
        // fail to decrypt anything, so treat it as locked rather than silently broken.
        const cached = await loadDeviceKey(memberId)
        if (cancelled) return
        if (cached && cached.keyCreated === d.key_created) {
          setPrivateKey(cached.privateKey)
          setState('unlocked')
        } else {
          if (cached) await clearDeviceKey(memberId)
          setState('locked')
        }
      })
      .catch(() => { if (!cancelled) setState('error') })

    return () => { cancelled = true }
  }, [memberId])

  /**
   * Set up a keypair from here. Normally unnecessary — bootstrapIdentityKey() already does
   * this silently at login, where the password is legitimately in hand. This survives for
   * the member whose session was restored from a cookie and who has never had a key.
   */
  const setup = useCallback(async (password: string) => {
    if (memberId == null) throw new Error('Not signed in')
    const { material: created, deviceKey } = await createKeyMaterial(password)
    await kscwApi('/identity/keys', {
      method: 'POST',
      body: { public_key: created.publicKey, private_key: created.privateKey, salt: created.salt },
    })
    // Re-read: the server owns e2ee_key_created, and a device key stamped with a time the
    // server never wrote would read as stale forever.
    const res = await kscwApi<KeysResponse>('/identity/keys')
    const stamp = res.data.has_keys ? res.data.key_created : new Date().toISOString()

    await saveDeviceKey({ memberId, privateKey: deviceKey, keyCreated: stamp })
    setMaterial(created)
    setKeyCreated(stamp)
    setPrivateKey(deviceKey)
    setState('unlocked')
  }, [memberId])

  /** Unlock on this device. Throws on a wrong password — AES-GCM's tag fails, unambiguously. */
  const unlock = useCallback(async (password: string) => {
    if (memberId == null || !material || !keyCreated) throw new Error('No key to unlock')
    const priv = await unwrapPrivateKey(material, password, false)
    await saveDeviceKey({ memberId, privateKey: priv, keyCreated })
    setPrivateKey(priv)
    setState('unlocked')
  }, [memberId, material, keyCreated])

  /** Forget the key on THIS device (e.g. a shared phone). The server copy is untouched. */
  const lock = useCallback(async () => {
    if (memberId == null) return
    await clearDeviceKey(memberId)
    setPrivateKey(null)
    setState(material ? 'locked' : 'none')
  }, [memberId, material])

  return { state, material, privateKey, keyCreated, setup, unlock, lock }
}
