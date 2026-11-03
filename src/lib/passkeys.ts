/**
 * Passkeys: sign in with the device's fingerprint, face or PIN instead of the
 * password (WebAuthn). The device keeps the key and checks the person; the server
 * (directus/extensions/kscw-endpoints/src/passkeys.js) checks the signature and sets
 * the same session cookie as a password sign-in.
 *
 * WHERE. A passkey belongs to a relying party (RP). Prod's RP is `kscw.ch`, so one key
 * serves the member app, Spielplanung and the books; dev's is `wiedisync-dev.kscw.ch`
 * (the dev member app only). The server accepts a ceremony only from these exact pages,
 * so the UI shows only there (PASSKEY_RP_BY_HOST) and only where the browser has
 * WebAuthn at all — inside the Android app that is a shell update away, and without
 * `PublicKeyCredential` the check below simply says no.
 *
 * WHAT THIS DEVICE REMEMBERS (per member, in localStorage — hints, never authority):
 *   on            a key for this member was set up or used here: the sign-in screen leads
 *                 with the passkey button and the offer is not repeated
 *   credentialIds the keys THIS device holds (not a phone used via QR code): what the
 *                 optional app lock asks for, offline
 *   dismissed     "Not now" to the offer after a password sign-in
 *   lock          ask for the fingerprint when the app opens (opt-in, off by default)
 */

import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { kscwApi } from './api'
import { captureAuthError, isTransientNetworkMessage } from './sentry'

// ── Where passkeys work ───────────────────────────────────────────────

/** Page host → relying party ID. Mirrors PASSKEY_SITES in the backend's passkeys-core.js. */
export const PASSKEY_RP_BY_HOST: Readonly<Record<string, string>> = Object.freeze({
  'wiedisync.kscw.ch': 'kscw.ch',
  'spielplanung.wiedisync.kscw.ch': 'kscw.ch',
  'accounting.wiedisync.kscw.ch': 'kscw.ch',
  'wiedisync-dev.kscw.ch': 'wiedisync-dev.kscw.ch',
})

/** The relying party for a page host, or null where passkeys are off. Exact match only. */
export function rpIdForHost(host: string | null | undefined): string | null {
  if (!host || !Object.prototype.hasOwnProperty.call(PASSKEY_RP_BY_HOST, host)) return null
  return PASSKEY_RP_BY_HOST[host]
}

function currentHost(): string {
  return typeof window === 'undefined' ? '' : window.location.hostname
}

/** This page can run a passkey ceremony at all (right host, WebAuthn present). */
export function passkeysPossible(host: string = currentHost()): boolean {
  if (!rpIdForHost(host)) return false
  try { return browserSupportsWebAuthn() } catch { return false }
}

/**
 * This device can keep a passkey itself (fingerprint reader, face, device PIN). The
 * offer after a password sign-in asks only then: a laptop without one can still sign
 * in with a phone's passkey, it is just not asked to keep one.
 */
export async function deviceCanHoldPasskey(): Promise<boolean> {
  if (!passkeysPossible()) return false
  try { return await platformAuthenticatorIsAvailable() } catch { return false }
}

// ── Errors ────────────────────────────────────────────────────────────

type ErrorLike = { name?: unknown; code?: unknown; status?: unknown; message?: unknown; cause?: { name?: unknown } | null }
const asErrorLike = (err: unknown): ErrorLike => (err && typeof err === 'object' ? err as ErrorLike : {})

/** The person closed the device's sheet or let it time out: nothing to say, nothing to report. */
export function isPasskeyCancel(err: unknown): boolean {
  const e = asErrorLike(err)
  const names = [e.name, e.cause?.name]
  return names.includes('NotAllowedError') || names.includes('AbortError') || e.code === 'ERROR_CEREMONY_ABORTED'
}

/** The device already holds a key for this account (it refused to make a second one). */
export function isPasskeyAlreadyHere(err: unknown): boolean {
  const e = asErrorLike(err)
  return e.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || e.name === 'InvalidStateError' || e.cause?.name === 'InvalidStateError'
}

/** The server's refusal code, when the error is one (kscwApi attaches `status` + `code`). */
export function passkeyErrorCode(err: unknown): string | null {
  const e = asErrorLike(err)
  return typeof e.code === 'string' && typeof e.status === 'number' ? e.code : null
}

/**
 * The i18n key (namespace `auth`) for a passkey failure. The server's refusals carry a
 * code; the device's own failures come without a status. Pure — the unit test pins it.
 */
export function passkeyErrorKey(err: unknown): string {
  const e = asErrorLike(err)
  const status = typeof e.status === 'number' ? e.status : null
  const code = status != null && typeof e.code === 'string' ? e.code : null
  if (isPasskeyAlreadyHere(err) || code === 'passkey_exists') return 'passkeyErrAlreadyHere'
  if (status == null) {
    if (isTransientNetworkMessage(String(e.message ?? ''))) return 'networkError'
    return 'passkeyErrDevice'
  }
  switch (code) {
    case 'passkey_unknown': return 'passkeyErrUnknown'
    // Timed out, already used, or the ceremony's cookie missing (another tab/browser):
    // nothing for the member to fix — just try again.
    case 'passkey_challenge': return 'passkeyErrExpired'
    // The licence lock (403): sign-in is off for now, for everybody.
    case 'resource_restricted': return 'passkeyErrRestricted'
    case 'passkey_origin': return 'passkeyErrOrigin'
    case 'passkey_invalid':
    case 'passkey_mismatch': return 'passkeyErrInvalid'
    case 'user_suspended': return 'passkeyErrSuspended'
    case 'password_required': return 'passkeyErrPasswordRequired'
    case 'bad_password': return 'passkeyErrBadPassword'
    case 'otp_required': return 'passkeyOtpNeeded'
    case 'otp_invalid': return 'passkeyErrOtpInvalid'
    case 'passkeys_full': return 'passkeyErrFull'
    case 'acting_forbidden': return 'passkeyErrActing'
    case 'rate_limited': return 'tooManyRequests'
    case 'passkeys_unavailable':
    case 'not_available': return 'passkeyErrUnavailable'
  }
  if (status === 429) return 'tooManyRequests'
  if (status === 503 || status === 404) return 'passkeyErrUnavailable'
  return 'passkeyErrGeneric'
}

/** A passkey failure in words. `t` is the `auth` namespace's. */
export function passkeyErrorText(t: (key: string) => string, err: unknown): string {
  return t(passkeyErrorKey(err))
}

/** Server refusals that mean something is wrong (a page the server does not accept, a bad signature). */
const REPORTED_CODES = new Set(['passkey_origin', 'passkey_invalid', 'passkey_mismatch'])

/**
 * Worth an error report? Never a cancel or a key that is already here; never the
 * designed refusals (a removed key, a wrong password, a code needed, a timed-out
 * challenge); never a 5xx or a dropped connection — kscwApi has reported those itself.
 */
export function isReportablePasskeyError(err: unknown): boolean {
  if (isPasskeyCancel(err) || isPasskeyAlreadyHere(err)) return false
  const e = asErrorLike(err)
  if (typeof e.status === 'number') return e.status < 500 && typeof e.code === 'string' && REPORTED_CODES.has(e.code)
  return !isTransientNetworkMessage(String(e.message ?? ''))
}

async function reportFailures<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (isReportablePasskeyError(err)) captureAuthError(err, { action, method: 'passkey' })
    throw err
  }
}

// ── The server ────────────────────────────────────────────────────────

export interface PasskeyRow {
  id: string
  credential_id: string
  label: string
  created_at: string
  last_used_at: string | null
}

/** The backend's cap per account (PASSKEYS_PER_USER_MAX). */
export const PASSKEYS_MAX = 10

interface CeremonyOptions<T> { data: { challengeId: string; options: T } }

export interface PasskeySignIn {
  /** The key that signed in (base64url). */
  credentialId: string
  /** False when the key lives elsewhere — a phone reached by QR code, a security key. */
  onDevice: boolean
}

/**
 * Sign in: the server's options → the device's sheet → the server checks the answer and
 * sets the session cookie. Throws on cancel too (isPasskeyCancel tells). Every request
 * goes out exactly once: the challenge is single-use, so kscwApi's refresh-and-resend
 * would only turn the real answer into "challenge used".
 *
 * ⚠ Both calls carry cookies (kscwApi's default `credentials: 'include'` — never
 * `anonymous`): login-options sets a short-lived httpOnly cookie that binds the ceremony
 * to this browser, and login refuses without it (`passkey_challenge`). login's answer
 * sets the session cookie, which a cookie-less request would drop too.
 */
export async function signInWithPasskey(): Promise<PasskeySignIn> {
  return reportFailures('login', async () => {
    const { data } = await kscwApi<CeremonyOptions<PublicKeyCredentialRequestOptionsJSON>>('/passkey/login-options', {
      method: 'POST', noAuthRetry: true,
    })
    const answer = await startAuthentication({ optionsJSON: data.options })
    await kscwApi('/passkey/login', {
      method: 'POST', body: { challengeId: data.challengeId, response: answer }, noAuthRetry: true,
    })
    return { credentialId: answer.id, onDevice: answer.authenticatorAttachment !== 'cross-platform' }
  })
}

export interface PasskeySetUp {
  passkey: PasskeyRow
  onDevice: boolean
}

/**
 * Set one up for the signed-in member: the password (+ the authenticator code when the
 * account has one — `otp_required`) → the device's sheet → the server stores the key and
 * mails the member. Sent once each: a resent wrong password would count twice toward the
 * account's lockout. The caller records the hint (rememberPasskeyHere).
 */
export async function setUpPasskey({ password, otp }: { password: string; otp?: string }): Promise<PasskeySetUp> {
  return reportFailures('passkey_setup', async () => {
    const { data } = await kscwApi<CeremonyOptions<PublicKeyCredentialCreationOptionsJSON>>('/passkey/register-options', {
      method: 'POST', body: otp ? { password, otp } : { password }, noAuthRetry: true,
    })
    const answer = await startRegistration({ optionsJSON: data.options })
    const res = await kscwApi<{ data: { passkey: PasskeyRow } }>('/passkey/register', {
      method: 'POST', body: { challengeId: data.challengeId, response: answer }, noAuthRetry: true,
    })
    return { passkey: res.data.passkey, onDevice: answer.authenticatorAttachment !== 'cross-platform' }
  })
}

export async function listPasskeys(): Promise<{ available: boolean; passkeys: PasskeyRow[] }> {
  const res = await kscwApi<{ data: { available: boolean; passkeys: PasskeyRow[] } }>('/passkey/list')
  return { available: res.data?.available === true, passkeys: res.data?.passkeys ?? [] }
}

export async function removePasskey(id: string): Promise<void> {
  await kscwApi(`/passkey/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── What this device remembers ────────────────────────────────────────

export interface PasskeyHint {
  on: boolean
  credentialIds: string[]
  dismissed: boolean
  lock: boolean
}

const HINTS_KEY = 'wiedisync-passkeys'
/** The backend's CREDENTIAL_ID_RE: base64url. */
const CREDENTIAL_ID_RE = /^[A-Za-z0-9_-]{1,1024}$/

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Whatever was stored, as a well-formed hint. The lock is never on without a key to ask for. */
function normaliseHint(raw: unknown): PasskeyHint {
  if (!isPlainObject(raw)) return { on: false, credentialIds: [], dismissed: false, lock: false }
  const ids = Array.isArray(raw.credentialIds)
    ? [...new Set(raw.credentialIds.filter((id): id is string => typeof id === 'string' && CREDENTIAL_ID_RE.test(id)))].slice(-PASSKEYS_MAX)
    : []
  return { on: raw.on === true, credentialIds: ids, dismissed: raw.dismissed === true, lock: raw.lock === true && ids.length > 0 }
}

function readAllHints(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HINTS_KEY) || '{}')
    return isPlainObject(parsed) ? parsed : {}
  } catch { return {} }
}

const hintListeners = new Set<() => void>()

function writeHint(memberId: string | number, update: (hint: PasskeyHint) => PasskeyHint): PasskeyHint {
  const key = String(memberId)
  const all = readAllHints()
  const next = normaliseHint(update(normaliseHint(all[key])))
  try {
    all[key] = next
    localStorage.setItem(HINTS_KEY, JSON.stringify(all))
  } catch { /* private mode / storage full: the offer may come again, nothing worse */ }
  for (const listener of hintListeners) listener()
  return next
}

export function readPasskeyHint(memberId: string | number | null | undefined): PasskeyHint {
  return normaliseHint(memberId == null ? null : readAllHints()[String(memberId)])
}

/** Somebody set up or used a passkey in this browser: the sign-in screen leads with it. */
export function anyPasskeyHere(): boolean {
  return Object.values(readAllHints()).some((h) => normaliseHint(h).on)
}

/** A key for this member was set up or used here. Only a key ON this device joins the lock's list. */
export function rememberPasskeyHere(memberId: string | number, credentialId: string | null, onDevice: boolean): PasskeyHint {
  return writeHint(memberId, (h) => ({
    ...h,
    on: true,
    credentialIds: onDevice && credentialId && !h.credentialIds.includes(credentialId) ? [...h.credentialIds, credentialId] : h.credentialIds,
  }))
}

/** "Not now" to the offer after a password sign-in. */
export function dismissPasskeyOffer(memberId: string | number): PasskeyHint {
  return writeHint(memberId, (h) => ({ ...h, dismissed: true }))
}

/** The app lock on or off (normaliseHint keeps it off without a key here). */
export function setPasskeyLock(memberId: string | number, on: boolean): PasskeyHint {
  return writeHint(memberId, (h) => ({ ...h, lock: on }))
}

/**
 * Bring the hint in line with the account's keys on the server. A key removed in Profile
 * — or all of them, by a password change — leaves the list; when none of this device's
 * keys are left, the lock goes off and the sign-in screen no longer leads with the
 * passkey. A member whose only use here was a phone's key keeps `on` while the account
 * still has keys.
 */
export function reconcilePasskeyHint(memberId: string | number, serverCredentialIds: readonly string[]): PasskeyHint {
  const before = readPasskeyHint(memberId)
  const server = new Set(serverCredentialIds)
  const kept = before.credentialIds.filter((id) => server.has(id))
  const lostAllHere = before.credentialIds.length > 0 && kept.length === 0
  const on = before.on && server.size > 0 && !lostAllHere
  if (kept.length === before.credentialIds.length && on === before.on) return before
  return writeHint(memberId, (h) => ({ ...h, on, credentialIds: kept, lock: h.lock && kept.length > 0 }))
}

/**
 * Show the offer after this password sign-in? Only on a device that can keep a key, when
 * the member has not said "Not now", the server has passkeys, and none of the account's
 * keys is known to be here (after reconciling — a password change removed them all, and
 * then the offer is exactly what is wanted). Never throws.
 */
export async function shouldOfferPasskey(memberId: string | number): Promise<boolean> {
  if (readPasskeyHint(memberId).dismissed) return false
  if (!(await deviceCanHoldPasskey())) return false
  let list: { available: boolean; passkeys: PasskeyRow[] }
  try { list = await listPasskeys() } catch { return false }
  if (!list.available || list.passkeys.length >= PASSKEYS_MAX) return false
  return !reconcilePasskeyHint(memberId, list.passkeys.map((p) => p.credential_id)).on
}

/** For useSyncExternalStore: a change here, or in another tab. */
export function subscribePasskeyHints(listener: () => void): () => void {
  hintListeners.add(listener)
  const onStorage = (e: StorageEvent) => { if (e.key === HINTS_KEY || e.key === null) listener() }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    hintListeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

/** A stable snapshot of one member's hint (a string, so an unchanged hint compares equal). */
export function passkeyHintSnapshot(memberId: string | number | null | undefined): string {
  return JSON.stringify(readPasskeyHint(memberId))
}

// ── The app lock: a local check, no server ────────────────────────────

/** The authenticator data's flags byte (after the 32-byte RP ID hash) has UV set: the person was verified. */
export function userVerified(authenticatorData: ArrayBuffer | ArrayBufferView): boolean {
  const bytes = authenticatorData instanceof ArrayBuffer
    ? new Uint8Array(authenticatorData)
    : new Uint8Array(authenticatorData.buffer, authenticatorData.byteOffset, authenticatorData.byteLength)
  return bytes.length > 32 && (bytes[32] & 0x04) !== 0
}

/** The device's answer unlocks: one of this device's keys, and the person verified. */
export function acceptLocalAssertion(credential: unknown, allowedIds: readonly string[]): boolean {
  if (!credential || typeof credential !== 'object') return false
  const c = credential as { type?: unknown; id?: unknown; response?: { authenticatorData?: unknown } | null }
  if (c.type !== 'public-key' || typeof c.id !== 'string' || !allowedIds.includes(c.id)) return false
  const data = c.response?.authenticatorData
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return false
  return userVerified(data)
}

export type LocalUnlockResult = 'ok' | 'cancel' | 'refused'

/**
 * The app lock's check: ask THIS device for one of its keys with a fresh random
 * challenge, and accept when it answers with a listed key and says the person was
 * verified. No server, so it works in a gym with no signal — and it proves nothing to
 * anyone but this screen: it is a curtain in front of a session that stays signed in,
 * not a sign-in. Start it from a tap only (Safari refuses without a user gesture).
 */
export async function unlockOnThisDevice(memberId: string | number): Promise<LocalUnlockResult> {
  const rpId = rpIdForHost(currentHost())
  const { credentialIds } = readPasskeyHint(memberId)
  if (!rpId || credentialIds.length === 0 || !passkeysPossible()) return 'refused'
  let credential: Credential | null
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId,
        // No allowCredentials: the same discoverable request as a sign-in, and the answer
        // is matched to this device's keys below. Inside the Android app (WebView, WebAuthn
        // run as the app) a request naming the key made Google's sheet look for it on a
        // security key or another phone instead of the passkey right on this one — the
        // lock never unlocked (owner's phone, 03.11.2026), while sign-in worked.
        userVerification: 'required',
        timeout: 60_000,
      },
    })
  } catch (err) {
    if (isPasskeyCancel(err)) return 'cancel'
    captureAuthError(err, { action: 'app_unlock', method: 'passkey' })
    return 'refused'
  }
  return acceptLocalAssertion(credential, credentialIds) ? 'ok' : 'refused'
}
