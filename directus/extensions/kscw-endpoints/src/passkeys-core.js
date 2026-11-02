/**
 * Passkey sign-in (WebAuthn): the ceremonies and their rules, free of the database and of
 * HTTP so a test can run them end to end against a software authenticator
 * (__tests__/passkeys.test.js). passkeys.js keeps the I/O: the rows, the session, the mail.
 *
 * A passkey is a key pair the member's device keeps; its fingerprint, face or PIN unlocks the
 * private key, and only the public key comes here. Ported from OpenVolley
 * (escoresheet/backend/lib/passkeys.js, live 02.11.2026) — one difference: the pages that may
 * run a ceremony are an exact list, not "any subdomain of the RP ID". kscw.ch is the club
 * website and *.kscw.ch holds other club apps; none of them may sign anyone in here.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers'
import { randomBytes } from 'node:crypto'

/** How long the device's sheet may stay open. */
export const PASSKEY_CEREMONY_MS = 2 * 60 * 1000
/** A challenge waits a little longer than the sheet, for a slow network. */
export const PASSKEY_CHALLENGE_TTL_MS = PASSKEY_CEREMONY_MS + 60 * 1000
/** Outstanding challenges at most. The sign-in options need no session, so the map has a
 *  ceiling that does not depend on the rate limits; the oldest go first. */
export const PASSKEY_CHALLENGES_MAX = 5000
/** Passkeys one account may have: phones, tablets, laptops and their replacements fit; a
 *  script making thousands does not. */
export const PASSKEYS_PER_USER_MAX = 10

const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])
export const CREDENTIAL_ID_RE = /^[A-Za-z0-9_-]{1,1024}$/

/**
 * The Android app (`ch.kscw.wiedisync`, and `.dev` with the same key) signs with this
 * certificate (android/README.md → Signing; also in public/.well-known/assetlinks.json). A
 * passkey ceremony started inside its WebView may report the app instead of the page as its
 * origin: `android:apk-key-hash:` + the certificate's SHA-256, base64url. Kept in the
 * colon-hex form everyone can compare with the README, and computed.
 */
export const ANDROID_RELEASE_CERT_SHA256 =
  '0D:79:B0:74:DE:19:FF:D0:87:E2:F5:56:C5:6D:09:F9:33:14:E8:28:D3:44:FC:F1:85:01:FB:DC:DE:9F:E2:38'

export function apkKeyHashOrigin(colonHex = ANDROID_RELEASE_CERT_SHA256) {
  return `android:apk-key-hash:${Buffer.from(colonHex.replace(/:/g, ''), 'hex').toString('base64url')}`
}

/**
 * Per Directus instance (picked by PUBLIC_URL): the relying party and the exact pages that
 * may run a ceremony. Prod: RP kscw.ch, so one key serves every club app on a kscw.ch host
 * that is listed here. Dev: RP wiedisync-dev.kscw.ch — Spielplanung-dev and Accounting-dev
 * keep using the member app's session, and a prod key can never be used on a dev page (nor
 * the other way round: neither RP ID is a suffix of the other's pages).
 */
export const PASSKEY_SITES = {
  'https://directus.kscw.ch': {
    rpId: 'kscw.ch',
    origins: [
      'https://wiedisync.kscw.ch',
      'https://spielplanung.wiedisync.kscw.ch',
      'https://accounting.wiedisync.kscw.ch',
    ],
  },
  'https://directus-dev.kscw.ch': {
    rpId: 'wiedisync-dev.kscw.ch',
    origins: ['https://wiedisync-dev.kscw.ch'],
  },
}

/**
 * The relying party for this instance, or null (passkeys off → 503). WEBAUTHN_RP_ID +
 * WEBAUTHN_ORIGINS (comma list) override, for a local test (RP `localhost`, origin
 * http://localhost:5173).
 */
export function passkeyConfig(env = process.env) {
  const rpOverride = String(env.WEBAUTHN_RP_ID || '').trim().toLowerCase()
  if (rpOverride) {
    const origins = String(env.WEBAUTHN_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean)
    if (!origins.length) return null
    return { rpId: rpOverride, rpName: 'KSC Wiedikon', origins }
  }
  const site = PASSKEY_SITES[String(env.PUBLIC_URL || '').trim().replace(/\/+$/, '')]
  if (!site) return null
  return { rpId: site.rpId, rpName: 'KSC Wiedikon', origins: [...site.origins, apkKeyHashOrigin()] }
}

/** May a page at `origin` run a ceremony for this relying party? Exact match only. */
export function originAllowed(origin, config) {
  return typeof origin === 'string' && origin.length > 0 && config.origins.includes(origin)
}

/** The origin a browser wrote into the answer (clientDataJSON), or ''. */
export function originOf(response) {
  try {
    const json = isoUint8Array.toUTF8String(isoBase64URL.toBuffer(String(response?.response?.clientDataJSON || '')))
    const origin = JSON.parse(json)?.origin
    return typeof origin === 'string' ? origin : ''
  } catch { return '' }
}

/** "iPhone · Safari", "Android · Chrome", "Android · App": the list in the profile and the
 *  mail read as the member's own devices, nothing more. */
export function passkeyDeviceLabel(userAgent) {
  const ua = String(userAgent || '')
  const device =
    /iPad/.test(ua) ? 'iPad'
      : /iPhone/.test(ua) ? 'iPhone'
        : /Android/.test(ua) ? 'Android'
          : /Macintosh|Mac OS X/.test(ua) ? (/Mobile/.test(ua) ? 'iPad' : 'Mac')
            : /Windows/.test(ua) ? 'Windows'
              : /CrOS/.test(ua) ? 'Chromebook'
                : /Linux/.test(ua) ? 'Linux'
                  : ''
  const browser =
    /WiedisyncApp\//.test(ua) ? 'App'
      : /Edg\//.test(ua) ? 'Edge'
        : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
          : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
            : /OPR\//.test(ua) ? 'Opera'
              : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
                : /Safari\//.test(ua) ? 'Safari'
                  : ''
  return [device, browser].filter(Boolean).join(' · ') || 'Device'
}

/** The device's transports, cut to the ones WebAuthn defines. */
export function cleanTransports(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(String).filter((t) => TRANSPORTS.has(t)))]
}

export class PasskeyError extends Error {
  /** code: 'challenge' (unknown, used or expired), 'unknown' (no such key), 'mismatch'
   *  (issued to someone else), 'origin', 'invalid' (signature, RP, user verification). */
  constructor(code, message) {
    super(message)
    this.name = 'PasskeyError'
    this.code = code
  }
}

/**
 * The two ceremonies with their challenges, held in this process: a restart costs whoever
 * had the sheet open one more tap. Each challenge is taken out of the map before it is
 * checked, so an answer sent twice finds nothing.
 */
export function createPasskeyCeremonies(config, now = Date.now) {
  const challenges = new Map()

  function sweep() {
    const t = now()
    for (const [id, entry] of challenges) if (entry.expiresAt < t) challenges.delete(id)
  }

  function issue(entry) {
    sweep()
    while (challenges.size >= PASSKEY_CHALLENGES_MAX) {
      const oldest = challenges.keys().next().value
      if (oldest === undefined) break
      challenges.delete(oldest)
    }
    const id = randomBytes(18).toString('base64url')
    challenges.set(id, { ...entry, expiresAt: now() + PASSKEY_CHALLENGE_TTL_MS })
    return id
  }

  function take(id, purpose) {
    const entry = typeof id === 'string' ? challenges.get(id) : undefined
    if (entry) challenges.delete(id)
    if (!entry || entry.purpose !== purpose || entry.expiresAt < now()) {
      throw new PasskeyError('challenge', 'challenge unknown, used or expired')
    }
    return entry
  }

  /** The answer's origin, checked against the list before the library sees it. */
  function allowedOrigin(response) {
    const origin = originOf(response)
    if (!originAllowed(origin, config)) throw new PasskeyError('origin', `origin not allowed: ${origin.slice(0, 80)}`)
    return origin
  }

  return {
    config,
    sweep,
    get pending() { return challenges.size },

    /**
     * Options for setting up a passkey. The user handle is the Directus user id (a UUID,
     * nothing personal), so a device that already holds a key for the account replaces it
     * instead of keeping two. Discoverable and user-verified, both required: sign-in starts
     * with no address typed, and "fingerprint or face" is the point. The name shown in the
     * device's account picker is the member's name — siblings share phones here.
     */
    async registrationOptions({ userId, email, displayName, existing }) {
      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpId,
        userID: isoUint8Array.fromUTF8String(String(userId)),
        userName: String(email || userId),
        userDisplayName: String(displayName || email || ''),
        timeout: PASSKEY_CEREMONY_MS,
        attestationType: 'none',
        excludeCredentials: (existing || []).map((p) => ({ id: p.credentialId, transports: p.transports })),
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        preferredAuthenticatorType: 'localDevice',
      })
      const challengeId = issue({ challenge: options.challenge, purpose: 'register', userId: String(userId) })
      return { challengeId, options }
    },

    async finishRegistration({ challengeId, userId, response }) {
      const entry = take(challengeId, 'register')
      if (entry.userId !== String(userId)) throw new PasskeyError('mismatch', 'challenge issued for another account')
      const origin = allowedOrigin(response)
      let verification
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge: entry.challenge,
          expectedOrigin: origin,
          expectedRPID: config.rpId,
          requireUserVerification: true,
        })
      } catch (err) {
        throw new PasskeyError('invalid', err?.message || String(err))
      }
      if (!verification.verified || !verification.registrationInfo) throw new PasskeyError('invalid', 'registration not verified')
      const info = verification.registrationInfo
      return {
        credentialId: info.credential.id,
        publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
        counter: info.credential.counter,
        transports: cleanTransports(info.credential.transports ?? response?.response?.transports),
        backedUp: info.credentialBackedUp === true,
      }
    },

    /** Options for signing in: no list of keys — the device offers what it has for the RP,
     *  and the answer says whose it was. */
    async authenticationOptions() {
      const options = await generateAuthenticationOptions({
        rpID: config.rpId,
        timeout: PASSKEY_CEREMONY_MS,
        userVerification: 'required',
      })
      const challengeId = issue({ challenge: options.challenge, purpose: 'login', userId: '' })
      return { challengeId, options }
    },

    /** lookup(credentialId) -> { id, userId, credentialId, publicKey, counter, transports } | null */
    async finishAuthentication({ challengeId, response, lookup }) {
      const entry = take(challengeId, 'login')
      const credentialId = typeof response?.id === 'string' ? response.id : ''
      // Checked before it goes anywhere near a query.
      if (!CREDENTIAL_ID_RE.test(credentialId)) throw new PasskeyError('invalid', 'no usable credential id')
      const origin = allowedOrigin(response)
      const passkey = await lookup(credentialId)
      if (!passkey) throw new PasskeyError('unknown', 'no such passkey')
      // The user handle, when the device sends one, must be the account the key is filed
      // under; the row is the authority either way.
      const handle = response?.response?.userHandle
      if (handle) {
        let claimed = ''
        try { claimed = isoUint8Array.toUTF8String(isoBase64URL.toBuffer(handle)) } catch { claimed = '' }
        if (claimed !== String(passkey.userId)) throw new PasskeyError('invalid', 'user handle does not match the passkey')
      }
      let verification
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: entry.challenge,
          expectedOrigin: origin,
          expectedRPID: config.rpId,
          credential: {
            id: passkey.credentialId,
            publicKey: isoBase64URL.toBuffer(passkey.publicKey),
            counter: Number(passkey.counter) || 0,
            transports: passkey.transports,
          },
          requireUserVerification: true,
        })
      } catch (err) {
        throw new PasskeyError('invalid', err?.message || String(err))
      }
      if (!verification.verified) throw new PasskeyError('invalid', 'authentication not verified')
      return { passkey, newCounter: verification.authenticationInfo.newCounter }
    },
  }
}
