/**
 * /kscw/passkey/* — sign in with the device's fingerprint, face or PIN (WebAuthn passkeys).
 *
 *   POST   /passkey/login-options      public   → { challengeId, options }
 *   POST   /passkey/login              public   → session cookie, like /auth/login mode=session
 *   POST   /passkey/register-options   signed in, { password, otp? } → { challengeId, options }
 *   POST   /passkey/register           signed in → { passkey }
 *   GET    /passkey/list               signed in → { passkeys }
 *   DELETE /passkey/:id                signed in → { ok }
 *
 * THE SESSION. Directus 12 has no passkey provider, and AuthenticationService.login() always
 * runs one (getUserID → provider.login). What it does have is refresh(): handed a row in
 * directus_sessions it checks the user is active (suspended → refused), the licence lock,
 * roles and app/admin access, runs the provider's refresh and the `auth.jwt` filter, rotates
 * the session with the grace period and stamps last_access — and signs the JWT. So a verified
 * passkey writes a seed row that lives 60 s and lets refresh(seed, { session: true }) turn it
 * into the real session; the cookie is set exactly like controllers/auth.js does. No JWT is
 * signed here and no session logic is copied. Read against @directus/api 12.5.0
 * (dist/services/authentication.js, dist/constants.js SESSION_COOKIE_OPTIONS) — re-check both
 * after a Directus upgrade; the ext smoke probes login-options.
 *
 * What login() does that refresh() doesn't is done here by hand: what kscw-hooks' `auth.login`
 * action does (wiedisync_active, last_online_at — written here, because an endpoint's
 * `emitter` is the extension-local one and never reaches the hooks), the activity row
 * Directus writes for a login, and our own user_logs entry. A passkey with user verification is two factors (the
 * device and the fingerprint/face/PIN), so an account with TOTP is not asked for its code at
 * sign-in — but it IS asked when setting a passkey up, or a stolen password alone could add
 * a key and skip the code for good.
 *
 * Setting one up needs the password (checked by Directus's own login, so wrong guesses count
 * toward auth_login_attempts and the account's suspension), never while acting for a
 * household member. Every new key is mailed to the login address. Any password change or
 * reset removes all of the account's keys (trigger trg_directus_users_password_passkeys,
 * migration 439 — in the same transaction as the password, whatever wrote it).
 *
 * The sign-in ceremony is bound to the browser that started it: login-options sets a
 * short-lived httpOnly cookie with the challenge id, and login wants it back — an answer
 * relayed from a script on another page cannot be replayed elsewhere.
 */

import { randomBytes } from 'node:crypto'
import { clientIp } from './client-ip.js'
import { createLimiter } from './public-upload.js'
import { writeUserLog } from './activity-log.js'
import { buildEmailLayout, escHtml, FRONTEND_URL } from './email-template.js'
import {
  CREDENTIAL_ID_RE,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEYS_PER_USER_MAX,
  PasskeyError,
  createPasskeyCeremonies,
  passkeyConfig,
  passkeyDeviceLabel,
} from './passkeys-core.js'

/** The seed row only has to survive the refresh() call right after it. */
const SEED_SESSION_MS = 60 * 1000
/** The cookie that binds a sign-in ceremony to the browser that asked for it. */
export const CHALLENGE_COOKIE = 'kscw_passkey_challenge'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The `exp` of a JWT Directus just signed, in ms — the cookie lives exactly as long. */
export function jwtExpiryMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null
  } catch { return null }
}

/**
 * The cookie options of @directus/api's SESSION_COOKIE_OPTIONS (dist/constants.js), from
 * Directus's parsed env (booleans are booleans there — process.env would say "false").
 * maxAge from the token itself, which refresh() signed with SESSION_COOKIE_TTL.
 */
export function sessionCookieOptions(env, accessToken, now = Date.now()) {
  const exp = jwtExpiryMs(accessToken)
  const opts = {
    httpOnly: true,
    domain: env.SESSION_COOKIE_DOMAIN,
    secure: Boolean(env.SESSION_COOKIE_SECURE),
    sameSite: env.SESSION_COOKIE_SAME_SITE || 'strict',
  }
  if (exp) opts.maxAge = Math.max(0, exp - now)
  return opts
}

/** Who is asking: the IP from Cloudflare's header (clientIp), not Directus's left-most
 *  X-Forwarded-For, which the client writes (SECURITY.md finding 12). directus_sessions.origin
 *  is varchar(255): a longer Origin header must not turn a sign-in into a 500. */
function requestMeta(req) {
  const acc = req.accountability || {}
  const origin = acc.origin ?? req.get?.('origin') ?? null
  const ip = clientIp(req)
  return {
    ip: ip && ip !== 'unknown' ? ip : (acc.ip ?? null),
    userAgent: acc.userAgent ?? req.get?.('user-agent') ?? null,
    origin: typeof origin === 'string' ? origin.slice(0, 255) : null,
  }
}

/**
 * Turn a verified passkey into a Directus session: the seed row → refresh(seed, session).
 * Returns { accessToken, expires } or throws Directus's own error (suspended, licence lock).
 */
export async function mintSession({ database, services, schema, userId, meta }) {
  const seed = randomBytes(48).toString('base64url') // 64 chars, like Directus's nanoid(64)
  await database('directus_sessions').insert({
    token: seed,
    user: userId,
    expires: new Date(Date.now() + SEED_SESSION_MS),
    ip: meta.ip,
    user_agent: meta.userAgent,
    origin: meta.origin,
  })
  const { AuthenticationService } = services
  const auth = new AuthenticationService({
    knex: database,
    schema,
    accountability: { user: null, role: null, roles: [], admin: false, app: false, ip: meta.ip, userAgent: meta.userAgent, origin: meta.origin },
  })
  try {
    const { accessToken, expires } = await auth.refresh(seed, { session: true })
    return { accessToken, expires }
  } catch (err) {
    await database('directus_sessions').where('token', seed).delete().catch(() => {})
    throw err
  }
}

/** Directus error → code, whichever way the error carries it. */
function directusCode(err) {
  return err?.code || err?.extensions?.code || ''
}

// ── The mail ────────────────────────────────────────────────────────────────

const MAIL_TEXTS = {
  german: {
    subject: 'WiediSync – Neuer Passkey',
    heading: 'Neuer Passkey',
    greeting: (name) => (name ? `Hallo ${name}` : 'Hallo'),
    body: (when, label) => `Am ${when} wurde deinem Konto ein Passkey hinzugefügt: ${label}. Auf diesem Gerät kannst du dich ab jetzt mit Fingerabdruck, Gesicht oder PIN anmelden.`,
    notYou: 'Warst das nicht du? Öffne Profil → Passkeys, entferne ihn und ändere dein Passwort.',
    button: 'Profil öffnen',
  },
  swiss_german: {
    subject: 'WiediSync – Neue Passkey',
    heading: 'Neue Passkey',
    greeting: (name) => (name ? `Hoi ${name}` : 'Hoi'),
    body: (when, label) => `Am ${when} isch dim Konto en Passkey dezuegfüegt worde: ${label}. Uf dem Grät chasch di ab jetzt mit Fingerabdruck, Gsicht oder PIN aamälde.`,
    notYou: 'Bisch das nöd du gsi? Gang uf Profil → Passkeys, lösch en und änder dis Passwort.',
    button: 'Profil öffne',
  },
  english: {
    subject: 'WiediSync – A passkey was added',
    heading: 'New passkey',
    greeting: (name) => (name ? `Hi ${name}` : 'Hi'),
    body: (when, label) => `A passkey was added to your account on ${when}: ${label}. From now on you can sign in on that device with your fingerprint, face or PIN.`,
    notYou: "If this wasn't you, open Profile → Passkeys, remove it and change your password.",
    button: 'Open profile',
  },
  french: {
    subject: "WiediSync – Nouvelle clé d'accès",
    heading: "Nouvelle clé d'accès",
    greeting: (name) => (name ? `Bonjour ${name}` : 'Bonjour'),
    body: (when, label) => `Le ${when}, une clé d'accès a été ajoutée à votre compte : ${label}. Sur cet appareil, vous pouvez désormais vous connecter avec votre empreinte, votre visage ou votre code.`,
    notYou: "Si ce n'était pas vous, ouvrez Profil → Clés d'accès, supprimez-la et changez votre mot de passe.",
    button: 'Ouvrir le profil',
  },
  italian: {
    subject: 'WiediSync – Nuova passkey',
    heading: 'Nuova passkey',
    greeting: (name) => (name ? `Ciao ${name}` : 'Ciao'),
    body: (when, label) => `Il ${when} è stata aggiunta una passkey al tuo account: ${label}. Su quel dispositivo puoi ora accedere con impronta, volto o PIN.`,
    notYou: 'Se non sei stato tu, apri Profilo → Passkey, rimuovila e cambia la password.',
    button: 'Apri il profilo',
  },
}

/** dd.mm.yyyy HH:MM, Zurich time (CLAUDE.md → Date & time format). */
export function zurichDateTime(date) {
  const d = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
  const t = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  return `${d} ${t}`
}

export function passkeyAddedMail({ language, firstName, label, at }) {
  const t = MAIL_TEXTS[language] || MAIL_TEXTS.german
  const body = `<p style="font-size:14px;line-height:1.6;color:#cbd5e1;margin:0 0 12px">${escHtml(t.body(zurichDateTime(at), label))}</p>`
    + `<p style="font-size:14px;line-height:1.6;color:#cbd5e1;margin:0">${escHtml(t.notYou)}</p>`
  const html = buildEmailLayout(body, {
    title: t.heading,
    greeting: t.greeting(firstName),
    ctaUrl: `${FRONTEND_URL || 'https://wiedisync.kscw.ch'}/profile`,
    ctaLabel: t.button,
  })
  return { subject: t.subject, html }
}

// ── Routes ──────────────────────────────────────────────────────────────────

/** Per-key fixed window, for the signed-in routes (createLimiter keys by IP). */
function createKeyedLimiter(max, windowMs) {
  const map = new Map()
  return {
    take(key) {
      const now = Date.now()
      const e = map.get(key)
      if (e && now < e.resetAt) {
        if (e.used >= max) return false
        e.used++
        return true
      }
      map.set(key, { used: 1, resetAt: now + windowMs })
      if (map.size > 10000) for (const [k, v] of map) if (v.resetAt < now) map.delete(k)
      return true
    },
  }
}

export function registerPasskeys(router, ctx) {
  const { database, services, getSchema, logger } = ctx
  const env = ctx.env || process.env
  const log = logger.child({ endpoint: 'passkeys' })
  const config = passkeyConfig(env)
  const ceremonies = config ? createPasskeyCeremonies(config) : null

  // A hall's wifi is one IP for a whole team: generous per IP, the challenge and the
  // signature are the real gate.
  const optionsIp = createLimiter(60, 60 * 1000)
  const loginIp = createLimiter(30, 60 * 1000)
  const setupUser = createKeyedLimiter(10, 60 * 60 * 1000)
  const manageUser = createKeyedLimiter(60, 60 * 1000)

  const unavailable = (res) => res.status(503).json({ error: 'Passkeys are not available', code: 'passkeys_unavailable' })
  const tooMany = (res) => res.status(429).json({ error: 'Too many attempts — try again later', code: 'rate_limited' })
  /** A refused ceremony: logged (code, page, account if known — never the answer itself), so
   *  a copied key (counter backwards) or a page that is not ours shows up in the logs. */
  const refuse = (res, err, { route, userId = null, req } = {}) => {
    const code = err instanceof PasskeyError ? err.code : 'invalid'
    const status = code === 'challenge' ? 400 : 401
    log.warn({
      msg: `passkey ${route} refused: ${code}`, endpoint: `passkey/${route}`, code, userId,
      origin: req ? requestMeta(req).origin : null, detail: String(err?.message || '').slice(0, 200),
    })
    return res.status(status).json({ error: 'The passkey could not be verified', code: `passkey_${code}` })
  }
  const challengeCookieOptions = () => ({
    httpOnly: true,
    secure: Boolean(env.SESSION_COOKIE_SECURE),
    sameSite: 'lax',
    path: '/kscw/passkey',
  })
  /** Signed in as yourself, not acting for a household member. */
  const self = (req, res) => {
    const userId = req.accountability?.user
    if (!userId) { res.status(401).json({ error: 'Authentication required' }); return null }
    if (req.accountability?.kscwGuardian) {
      res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      return null
    }
    return userId
  }
  const rowsOf = (userId) => database('passkeys').where('user', userId)
    .orderBy('created_at', 'asc')
    .select('id', 'credential_id', 'label', 'transports', 'created_at', 'last_used_at')
  const publicRow = (r) => ({
    id: r.id, credential_id: r.credential_id, label: r.label, created_at: r.created_at, last_used_at: r.last_used_at,
  })

  // ── Sign in ──

  router.post('/passkey/login-options', async (req, res) => {
    if (!ceremonies) return unavailable(res)
    if (!optionsIp.take(req)) return tooMany(res)
    try {
      const data = await ceremonies.authenticationOptions()
      res.cookie(CHALLENGE_COOKIE, data.challengeId, { ...challengeCookieOptions(), maxAge: PASSKEY_CHALLENGE_TTL_MS })
      res.json({ data })
    } catch (err) {
      log.error({ msg: `passkey login-options: ${err.message}`, endpoint: 'passkey/login-options', stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/passkey/login', async (req, res) => {
    if (!ceremonies) return unavailable(res)
    if (!loginIp.take(req)) return tooMany(res)
    const { challengeId, response } = req.body ?? {}
    // Bound to the browser that asked: the challenge id must come back in its cookie too.
    const bound = req.cookies?.[CHALLENGE_COOKIE]
    res.clearCookie?.(CHALLENGE_COOKIE, challengeCookieOptions())
    if (typeof challengeId !== 'string' || bound !== challengeId) {
      return refuse(res, new PasskeyError('challenge', bound ? 'challenge cookie does not match' : 'no challenge cookie'), { route: 'login', req })
    }
    let result
    try {
      result = await ceremonies.finishAuthentication({
        challengeId,
        response,
        lookup: async (credentialId) => {
          const row = await database('passkeys').where('credential_id', credentialId)
            .first('id', 'user', 'credential_id', 'public_key', 'counter', 'transports')
          return row ? {
            id: row.id, userId: row.user, credentialId: row.credential_id,
            publicKey: row.public_key, counter: row.counter, transports: row.transports || [],
          } : null
        },
      })
    } catch (err) {
      // A refused passkey is the member's device or a stale key, not a fault.
      if (!(err instanceof PasskeyError)) {
        log.error({ msg: `passkey login verify: ${err.message}`, endpoint: 'passkey/login', stack: err.stack })
        return res.status(500).json({ error: 'Internal error' })
      }
      return refuse(res, err, { route: 'login', req })
    }

    const { passkey, newCounter } = result
    const meta = requestMeta(req)
    try {
      // The counter only moves forward; a key that does not count (most synced passkeys
      // report 0) stays at 0. No row updated = the key was removed meanwhile (a password
      // change, Profile → Remove) or a parallel sign-in got there first: no session.
      const moved = await database('passkeys')
        .where('id', passkey.id)
        .andWhere((q) => q.where('counter', '<', newCounter).orWhere('counter', 0))
        .update({ counter: newCounter, last_used_at: new Date() })
      if (!moved) {
        return refuse(res, new PasskeyError('invalid', 'key removed or counter did not move forward'), { route: 'login', userId: passkey.userId, req })
      }

      const schema = await getSchema()
      let session
      try {
        session = await mintSession({ database, services, schema, userId: passkey.userId, meta })
      } catch (err) {
        const code = directusCode(err)
        if (code === 'USER_SUSPENDED') return res.status(401).json({ error: 'This account is suspended', code: 'user_suspended' })
        if (code === 'INVALID_CREDENTIALS') return res.status(401).json({ error: 'This account cannot sign in', code: 'passkey_invalid' })
        if (code === 'RESOURCE_RESTRICTED') return res.status(403).json({ error: 'Sign-in is not possible right now', code: 'resource_restricted' })
        throw err
      }

      res.cookie(env.SESSION_COOKIE_NAME, session.accessToken, sessionCookieOptions(env, session.accessToken))

      const accountability = { user: passkey.userId, role: null, ip: meta.ip, userAgent: meta.userAgent, origin: meta.origin }
      try {
        const { ActivityService } = services
        await new ActivityService({ knex: database, schema }).createOne({
          action: 'login', user: passkey.userId, ip: meta.ip, user_agent: meta.userAgent, origin: meta.origin,
          collection: 'directus_users', item: passkey.userId,
        })
      } catch (err) {
        log.warn({ msg: `passkey login activity row: ${err.message}`, endpoint: 'passkey/login', userId: passkey.userId })
      }
      // kscw-hooks' auth.login action, by hand (it cannot hear this endpoint's emitter).
      try {
        await database('members').where('user', passkey.userId).where('wiedisync_active', false).update({ wiedisync_active: true })
        await database('members').where('user', passkey.userId).update({ last_online_at: new Date() })
      } catch (err) {
        log.warn({ msg: `passkey login post-login writes: ${err.message}`, endpoint: 'passkey/login', userId: passkey.userId })
      }
      await writeUserLog(database, log, {
        accountability, action: 'login', collection: 'passkeys', recordId: passkey.id, data: { what: 'passkey_login' },
      })

      res.json({ data: { ok: true, expires: session.expires } })
    } catch (err) {
      log.error({ msg: `passkey login: ${err.message}`, endpoint: 'passkey/login', userId: passkey.userId, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Set up ──

  router.post('/passkey/register-options', async (req, res) => {
    if (!ceremonies) return unavailable(res)
    const userId = self(req, res)
    if (!userId) return
    if (!setupUser.take(userId)) return tooMany(res)
    const { password, otp } = req.body ?? {}
    if (!password) return res.status(400).json({ error: 'password is required', code: 'password_required' })
    try {
      const user = await database('directus_users').where('id', userId).first('id', 'email', 'status', 'provider')
      if (!user?.email || user.status !== 'active') return res.status(403).json({ error: 'Not available for this account', code: 'not_available' })

      // The password, checked by Directus's own login (counts toward auth_login_attempts).
      // No accountability, like change-password: a check is not a login, so Directus writes
      // no activity row. Its session row is not wanted either: deleted straight away.
      const schema = await getSchema()
      const { AuthenticationService } = services
      const auth = new AuthenticationService({ knex: database, schema, accountability: null })
      try {
        const check = await auth.login('default', { email: user.email, password: String(password) }, { otp: otp ? String(otp) : undefined })
        if (check?.refreshToken) await database('directus_sessions').where('token', check.refreshToken).delete()
        // The address resolves case-insensitively: make sure it was THIS account's password.
        if (String(check?.id) !== String(userId)) {
          return res.status(401).json({ error: 'Current password is incorrect', code: 'bad_password' })
        }
      } catch (err) {
        const code = directusCode(err)
        // INVALID_OTP comes only after the password itself was right.
        if (code === 'INVALID_OTP') {
          return res.status(401).json({ error: otp ? 'The code is not right' : 'Your authenticator code is needed', code: otp ? 'otp_invalid' : 'otp_required' })
        }
        if (code === 'USER_SUSPENDED') return res.status(403).json({ error: 'This account is suspended', code: 'user_suspended' })
        return res.status(401).json({ error: 'Current password is incorrect', code: 'bad_password' })
      }

      const existing = await rowsOf(userId)
      if (existing.length >= PASSKEYS_PER_USER_MAX) {
        return res.status(409).json({ error: 'Too many passkeys — remove one first', code: 'passkeys_full' })
      }
      const member = await database('members').where('user', userId).first('first_name', 'last_name')
      const displayName = [member?.first_name, member?.last_name].filter(Boolean).join(' ').trim()
      const data = await ceremonies.registrationOptions({
        userId,
        email: user.email,
        displayName,
        existing: existing.map((r) => ({ credentialId: r.credential_id, transports: r.transports || [] })),
      })
      res.json({ data })
    } catch (err) {
      log.error({ msg: `passkey register-options: ${err.message}`, endpoint: 'passkey/register-options', userId, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/passkey/register', async (req, res) => {
    if (!ceremonies) return unavailable(res)
    const userId = self(req, res)
    if (!userId) return
    if (!manageUser.take(userId)) return tooMany(res)
    const { challengeId, response } = req.body ?? {}
    let made
    try {
      made = await ceremonies.finishRegistration({ challengeId, userId, response })
    } catch (err) {
      if (!(err instanceof PasskeyError)) {
        log.error({ msg: `passkey register verify: ${err.message}`, endpoint: 'passkey/register', userId, stack: err.stack })
        return res.status(500).json({ error: 'Internal error' })
      }
      return refuse(res, err, { route: 'register', userId, req })
    }
    try {
      const label = passkeyDeviceLabel(requestMeta(req).userAgent).slice(0, 80)
      const row = await database.transaction(async (trx) => {
        // Lock the account's rows so two set-ups at once cannot both pass the cap.
        await trx.raw('SELECT id FROM directus_users WHERE id = ? FOR UPDATE', [userId])
        const [{ n }] = await trx('passkeys').where('user', userId).count({ n: '*' })
        if (Number(n) >= PASSKEYS_PER_USER_MAX) return null
        const [inserted] = await trx('passkeys').insert({
          user: userId,
          credential_id: made.credentialId,
          public_key: made.publicKey,
          counter: made.counter || 0,
          transports: made.transports,
          backed_up: made.backedUp,
          label,
        }, ['id', 'credential_id', 'label', 'created_at', 'last_used_at'])
        return inserted
      })
      if (!row) return res.status(409).json({ error: 'Too many passkeys — remove one first', code: 'passkeys_full' })

      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'create', collection: 'passkeys', recordId: row.id,
        data: { what: 'passkey_added', label },
      })
      void sendAddedMail(userId, label, row.created_at)
      res.json({ data: { passkey: publicRow(row) } })
    } catch (err) {
      if (err?.code === '23505') return res.status(409).json({ error: 'This passkey is already set up', code: 'passkey_exists' })
      log.error({ msg: `passkey register: ${err.message}`, endpoint: 'passkey/register', userId, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  async function sendAddedMail(userId, label, at) {
    try {
      const user = await database('directus_users').where('id', userId).first('email')
      if (!user?.email) return
      const member = await database('members').where('user', userId).first('first_name', 'language')
      const { subject, html } = passkeyAddedMail({
        language: member?.language, firstName: member?.first_name || '', label, at: at ? new Date(at) : new Date(),
      })
      const { MailService } = services
      await new MailService({ schema: await getSchema(), knex: database }).send({ to: user.email, subject, html })
    } catch (err) {
      log.error({ msg: `passkey added mail: ${err.message}`, endpoint: 'passkey/register', userId, stack: err.stack })
    }
  }

  // ── Manage ──

  router.get('/passkey/list', async (req, res) => {
    const userId = self(req, res)
    if (!userId) return
    if (!manageUser.take(userId)) return tooMany(res)
    try {
      const rows = await rowsOf(userId)
      res.json({ data: { available: Boolean(ceremonies), passkeys: rows.map(publicRow) } })
    } catch (err) {
      log.error({ msg: `passkey list: ${err.message}`, endpoint: 'passkey/list', userId, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  router.delete('/passkey/:id', async (req, res) => {
    const userId = self(req, res)
    if (!userId) return
    if (!manageUser.take(userId)) return tooMany(res)
    const id = String(req.params.id || '')
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' })
    try {
      const gone = await database('passkeys').where({ id, user: userId }).delete(['id', 'label'])
      if (!gone.length) return res.status(404).json({ error: 'Not found' })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'delete', collection: 'passkeys', recordId: id,
        data: { what: 'passkey_removed', label: gone[0].label },
      })
      res.json({ data: { ok: true } })
    } catch (err) {
      log.error({ msg: `passkey delete: ${err.message}`, endpoint: 'passkey/delete', userId, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // Answered challenges leave the used set when they expire, even when nobody signs in.
  if (ceremonies) {
    const timer = setInterval(() => ceremonies.sweep(), 60 * 1000)
    timer.unref?.()
  }

  return { config, ceremonies }
}

export { CREDENTIAL_ID_RE }
