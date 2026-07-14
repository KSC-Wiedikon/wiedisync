import { kscwApi } from './api'
import { createKeyMaterial, unwrapPrivateKey } from './e2ee'
import { clearDeviceKey, loadDeviceKey, saveDeviceKey } from './e2eeStore'

interface KeysResponse {
  data:
    | { has_keys: false }
    | { has_keys: true; public_key: string; private_key: string; salt: string; key_created: string }
}

/**
 * Set up (or unlock) the member's encryption key — silently, at login.
 *
 * Login is the ONE moment the app legitimately holds the plaintext password. Every other
 * render restores the session from an httpOnly cookie and has no access to it. So this is
 * the only place a key can be created or unlocked without asking the member to re-type
 * something they just typed.
 *
 * Doing it here is what removes the "create your key" button and the unlock prompt from the
 * normal path: a member who logs in simply HAS a working key, and never learns any of this
 * exists until they upload a document. The prompt in the UI survives only for the case it is
 * actually needed — a session restored from a cookie on a device that has never held the key.
 *
 * Costs at most ONE PBKDF2 (~0.4s), and none at all when the device key is already current.
 * Deliberately non-blocking and deliberately silent on failure: a member must be able to log
 * in and use the app even if key setup fails. Nothing else in the app depends on this.
 */
export async function bootstrapIdentityKey(memberId: number, password: string): Promise<void> {
  const res = await kscwApi<KeysResponse>('/identity/keys')

  if (!res.data.has_keys) {
    const { material, deviceKey } = await createKeyMaterial(password)
    await kscwApi('/identity/keys', {
      method: 'POST',
      body: {
        public_key: material.publicKey,
        private_key: material.privateKey,
        salt: material.salt,
      },
    })
    // Re-read rather than stamping our own timestamp: the server owns e2ee_key_created, and
    // a device key tagged with a time the server never wrote would look stale forever.
    const after = await kscwApi<KeysResponse>('/identity/keys')
    if (after.data.has_keys) {
      await saveDeviceKey({ memberId, privateKey: deviceKey, keyCreated: after.data.key_created })
    }
    return
  }

  const { private_key: priv, salt, key_created: keyCreated, public_key: pub } = res.data
  void pub

  // Already current on this device — nothing to do, and no PBKDF2 to pay for.
  const cached = await loadDeviceKey(memberId)
  if (cached && cached.keyCreated === keyCreated) return

  // Stale (they re-keyed elsewhere) or absent. Unwrap with the password we have right now.
  if (cached) await clearDeviceKey(memberId)
  const deviceKey = await unwrapPrivateKey({ privateKey: priv, salt }, password, false)
  await saveDeviceKey({ memberId, privateKey: deviceKey, keyCreated })
}
