/**
 * /kscw/email-accounts — the club mailbox credential store ("Emails Garage").
 *
 *   GET    /kscw/email-accounts                 — list, sport-scoped, NO passwords
 *   GET    /kscw/email-accounts/:id/password    — reveal ONE password (audited)
 *   POST   /kscw/email-accounts                 — create            (global admin)
 *   PATCH  /kscw/email-accounts/:id             — update            (global admin)
 *   DELETE /kscw/email-accounts/:id             — delete            (global admin)
 *   POST   /kscw/email-accounts/sync-migadu     — sweep Migadu      (global admin)
 *
 * Why an endpoint and not a Directus collection: `email_accounts` has no
 * directus_collections row on purpose (see 326-email-accounts.sql), so the items
 * API cannot serve it to anyone — admins included. Everything below is raw knex,
 * which means the actor is invisible to Directus' revision trail and every
 * mutation here calls writeUserLog explicitly (CLAUDE.md → audit logging).
 *
 * ⚠⚠ The list route NEVER selects password_enc. Reveal is a separate, per-row,
 * audited call. That split is the entire access-control story: a single leak of
 * the list response is a leak of which mailboxes exist, not of how to read them.
 *
 * ⚠ Read is `isAdmin` (admin | superuser | vb_admin | bb_admin), scoped by sport.
 *   Write is GLOBAL admin only (admin | superuser). A sport admin looking up the
 *   volleyball scheduling password must not be able to retitle finance@ or point
 *   an existing row at a password they chose.
 *
 * Env:
 *   EMAIL_VAULT_KEY   32-byte key, hex (64 chars) or base64. REQUIRED to store or
 *                     reveal a password; without it the page still lists accounts
 *                     and says so. Generate: openssl rand -hex 32
 *   MIGADU_API_USER   Migadu admin account email (the API's Basic-auth username)
 *   MIGADU_API_KEY    Migadu API key (panel → My Account → API Keys)
 *   MIGADU_DOMAINS    comma list to sweep; default is the six live kscw.ch domains
 */

import crypto from 'crypto'
import { writeUserLog } from './activity-log.js'

// ── Constants ────────────────────────────────────────────────────

const GLOBAL_ROLES = ['admin', 'superuser']
const SPORT_ROLES = { vb_admin: 'volleyball', bb_admin: 'basketball' }

const SPORTS = ['volleyball', 'basketball', 'club']
const PROVIDERS = ['migadu', 'ses', 'clubdesk', 'google', 'other']

/**
 * Domains the Migadu sweep asks about. Migadu's API is per-domain — there is no
 * "list every mailbox on the account" call — so an unlisted domain is simply
 * never seen, silently. Override with MIGADU_DOMAINS when a new subdomain lands.
 */
const DEFAULT_MIGADU_DOMAINS = [
  'kscw.ch',
  'mail.kscw.ch',
  'volleyball.kscw.ch',
  'basketball.kscw.ch',
  'wiedisync.kscw.ch',
  'noreply.kscw.ch',
]

const MIGADU_API = 'https://api.migadu.com/v1'

/** Columns safe to return in a list — password_enc is deliberately absent. */
const LIST_COLUMNS = [
  'id', 'address', 'domain', 'label', 'sport', 'provider', 'notes',
  'migadu_managed', 'is_active', 'last_seen_at', 'sort',
  'created_by_name', 'updated_by_name', 'date_created', 'date_updated',
]

const MAX_LEN = { label: 200, notes: 2000, password: 512, address: 320 }

// ── Crypto ───────────────────────────────────────────────────────

/**
 * Parse EMAIL_VAULT_KEY into 32 raw bytes, or null when unset/malformed.
 *
 * Returning null rather than throwing is load-bearing: an unconfigured key must
 * degrade to "accounts listed, passwords unavailable" — a page that says so —
 * rather than a 500 that reads like the feature is broken.
 */
function vaultKey() {
  const raw = (process.env.EMAIL_VAULT_KEY || '').trim()
  if (!raw) return null
  try {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
    const buf = Buffer.from(raw, 'base64')
    return buf.length === 32 ? buf : null
  } catch { return null }
}

/** AES-256-GCM → `v1:<iv_b64>:<tag_b64>:<ct_b64>`. */
function encryptSecret(plain, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

/**
 * Reverse of encryptSecret. Throws on a wrong key or tampered ciphertext (GCM
 * authenticates), which the caller turns into a 500 with a distinct message —
 * "the key changed" and "there is no password" must not look alike.
 */
function decryptSecret(blob, key) {
  const parts = String(blob).split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('unknown ciphertext format')
  const [, ivB64, tagB64, ctB64] = parts
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}

// ── Domain helpers ───────────────────────────────────────────────

/**
 * Seed the sport from the address's domain. Only the two sport subdomains are
 * unambiguous; everything else is club-wide until a human says otherwise, which
 * is the safe direction — 'club' is visible to MORE admins, never fewer, so a
 * wrong guess never hides a mailbox from the person who needs it.
 */
function sportForAddress(address) {
  const domain = String(address || '').split('@')[1]?.toLowerCase() || ''
  if (domain === 'volleyball.kscw.ch') return 'volleyball'
  if (domain === 'basketball.kscw.ch') return 'basketball'
  return 'club'
}

function normalizeAddress(raw) {
  const address = String(raw || '').trim().toLowerCase()
  if (!address || address.length > MAX_LEN.address) return null
  // Same shape as the table's CHECK — reject here so the caller gets a readable
  // error instead of a Postgres constraint name.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null
  return address
}

function clampText(raw, max) {
  if (raw === null || raw === undefined) return null
  const value = String(raw).trim()
  if (!value) return null
  return value.slice(0, max)
}

// ── Registration ─────────────────────────────────────────────────

export function registerEmailAccounts(router, { database, logger }) {
  const log = logger?.child?.({ endpoint: 'email-accounts' }) || logger || console

  /**
   * Resolve the caller's admin tier once per request.
   *
   * `req.accountability.admin` is a Directus *system* admin (the static token,
   * cron-service) — treated as global, since it already bypasses every policy in
   * the instance and pretending otherwise would only be theatre.
   */
  async function tier(req) {
    if (req.accountability?.admin) return { global: true, sports: SPORTS }
    const userId = req.accountability?.user
    if (!userId) return null
    const m = await database('members').where('user', userId).first('id', 'role', 'first_name', 'last_name')
    if (!m) return null
    const roles = Array.isArray(m.role)
      ? m.role
      : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])

    const global = GLOBAL_ROLES.some((r) => roles.includes(r))
    if (global) {
      return { global: true, sports: SPORTS, memberId: m.id, name: memberName(m) }
    }

    // A sport admin sees their own section plus everything club-wide. Two hats
    // (vb_admin + bb_admin) accumulate rather than collide.
    const sports = ['club']
    for (const [role, sport] of Object.entries(SPORT_ROLES)) {
      if (roles.includes(role)) sports.push(sport)
    }
    if (sports.length === 1) return null // no sport hat and not global → not an admin at all
    return { global: false, sports, memberId: m.id, name: memberName(m) }
  }

  function memberName(m) {
    return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null
  }

  /** Read gate: any admin tier. Responds 403 and returns null when refused. */
  async function requireAdmin(req, res) {
    const who = await tier(req)
    if (!who) { res.status(403).json({ error: 'Not authorised' }); return null }
    return who
  }

  /** Write gate: global admin only. */
  async function requireGlobal(req, res) {
    const who = await tier(req)
    if (!who) { res.status(403).json({ error: 'Not authorised' }); return null }
    if (!who.global) {
      res.status(403).json({ error: 'Only a club admin can change email accounts', code: 'global_admin_required' })
      return null
    }
    return who
  }

  /**
   * Fetch one row the caller is allowed to see. Returns undefined for both "no
   * such row" and "out of your sport scope" on purpose — a sport admin probing
   * ids must not be able to tell a basketball account exists from a 403 vs a 404.
   */
  async function scopedRow(id, who, columns) {
    const numeric = Number(id)
    if (!Number.isInteger(numeric) || numeric <= 0) return undefined
    return database('email_accounts')
      .where('id', numeric)
      .whereIn('sport', who.sports)
      .first(columns)
  }

  // ── List ───────────────────────────────────────────────────────
  router.get('/email-accounts', async (req, res) => {
    try {
      const who = await requireAdmin(req, res)
      if (!who) return

      const rows = await database('email_accounts')
        .whereIn('sport', who.sports)
        .select([
          ...LIST_COLUMNS,
          // Presence, not content. The page needs to distinguish "no password on
          // file" from "click to reveal" without the ciphertext ever leaving the
          // container.
          database.raw('(password_enc IS NOT NULL) AS has_password'),
        ])
        .orderByRaw('COALESCE(sort, 1000), domain, address')

      res.json({
        accounts: rows,
        // The page renders a banner instead of reveal buttons when this is false,
        // so an unset key reads as a deployment step rather than a silent failure
        // where every reveal 500s.
        vault_configured: Boolean(vaultKey()),
        can_edit: who.global,
        scope: who.sports,
        migadu_configured: Boolean(process.env.MIGADU_API_USER && process.env.MIGADU_API_KEY),
      })
    } catch (err) {
      log.error?.({ msg: `email-accounts list: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Could not load the email accounts' })
    }
  })

  // ── Reveal one password ────────────────────────────────────────
  router.get('/email-accounts/:id/password', async (req, res) => {
    try {
      const who = await requireAdmin(req, res)
      if (!who) return

      const key = vaultKey()
      if (!key) {
        return res.status(503).json({ error: 'The credential vault key is not configured on this server', code: 'vault_unconfigured' })
      }

      const row = await scopedRow(req.params.id, who, ['id', 'address', 'sport', 'password_enc'])
      if (!row) return res.status(404).json({ error: 'Not found' })
      if (!row.password_enc) return res.status(404).json({ error: 'No password stored for this account', code: 'no_password' })

      let password
      try {
        password = decryptSecret(row.password_enc, key)
      } catch (err) {
        // Almost always EMAIL_VAULT_KEY having been rotated without re-entering
        // the passwords. Say that, because "decryption failed" sends whoever
        // reads it looking for a corrupt database instead.
        log.error?.({ msg: `email-accounts decrypt failed for ${row.address}: ${err.message}` })
        return res.status(500).json({
          error: 'Could not decrypt this password — the vault key does not match the one it was stored with',
          code: 'vault_key_mismatch',
        })
      }

      // Audited BEFORE the response is written: a reveal that reaches the client
      // must never be able to go unlogged because the insert lost a race.
      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'reveal',
        collection: 'email_accounts',
        recordId: row.id,
        data: { address: row.address },
      })

      res.set('Cache-Control', 'no-store')
      res.json({ id: row.id, address: row.address, password })
    } catch (err) {
      log.error?.({ msg: `email-accounts reveal: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Could not reveal the password' })
    }
  })

  // ── Create ─────────────────────────────────────────────────────
  router.post('/email-accounts', async (req, res) => {
    try {
      const who = await requireGlobal(req, res)
      if (!who) return

      const body = req.body || {}
      const address = normalizeAddress(body.address)
      if (!address) return res.status(400).json({ error: 'A valid email address is required', code: 'bad_address' })

      const sport = SPORTS.includes(body.sport) ? body.sport : sportForAddress(address)
      const provider = PROVIDERS.includes(body.provider) ? body.provider : 'migadu'

      const row = {
        address,
        label: clampText(body.label, MAX_LEN.label),
        sport,
        provider,
        notes: clampText(body.notes, MAX_LEN.notes),
        is_active: body.is_active === false ? false : true,
        sort: Number.isInteger(body.sort) ? body.sort : null,
        created_by_name: who.name,
        updated_by_name: who.name,
      }

      const password = clampText(body.password, MAX_LEN.password)
      if (password) {
        const key = vaultKey()
        if (!key) return res.status(503).json({ error: 'The credential vault key is not configured on this server', code: 'vault_unconfigured' })
        row.password_enc = encryptSecret(password, key)
      }

      let created
      try {
        [created] = await database('email_accounts').insert(row).returning(LIST_COLUMNS)
      } catch (err) {
        if (String(err.message || '').includes('email_accounts_address_key')) {
          return res.status(409).json({ error: 'That address is already in the list', code: 'duplicate_address' })
        }
        throw err
      }

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'create',
        collection: 'email_accounts',
        recordId: created.id,
        // The password is never logged — only whether one was set, which is the
        // part an auditor actually needs.
        data: { address, sport, provider, password_set: Boolean(password) },
      })

      res.status(201).json({ account: { ...created, has_password: Boolean(password) } })
    } catch (err) {
      log.error?.({ msg: `email-accounts create: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Could not add the account' })
    }
  })

  // ── Update ─────────────────────────────────────────────────────
  router.patch('/email-accounts/:id', async (req, res) => {
    try {
      const who = await requireGlobal(req, res)
      if (!who) return

      const existing = await scopedRow(req.params.id, who, ['id', 'address', 'password_enc'])
      if (!existing) return res.status(404).json({ error: 'Not found' })

      const body = req.body || {}
      const patch = { updated_by_name: who.name, date_updated: new Date() }
      const logged = {}

      if (body.address !== undefined) {
        const address = normalizeAddress(body.address)
        if (!address) return res.status(400).json({ error: 'A valid email address is required', code: 'bad_address' })
        patch.address = address
        logged.address = address
      }
      if (body.label !== undefined) patch.label = clampText(body.label, MAX_LEN.label)
      if (body.notes !== undefined) patch.notes = clampText(body.notes, MAX_LEN.notes)
      if (body.sport !== undefined) {
        if (!SPORTS.includes(body.sport)) return res.status(400).json({ error: 'Unknown sport', code: 'bad_sport' })
        patch.sport = body.sport
        logged.sport = body.sport
      }
      if (body.provider !== undefined) {
        if (!PROVIDERS.includes(body.provider)) return res.status(400).json({ error: 'Unknown provider', code: 'bad_provider' })
        patch.provider = body.provider
      }
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
      if (body.sort !== undefined) patch.sort = Number.isInteger(body.sort) ? body.sort : null

      // `password: ''` clears the stored password; an absent key leaves it alone.
      // The distinction matters — every edit of a label would otherwise wipe the
      // credential the page exists to hold.
      if (body.password !== undefined) {
        const password = clampText(body.password, MAX_LEN.password)
        if (password) {
          const key = vaultKey()
          if (!key) return res.status(503).json({ error: 'The credential vault key is not configured on this server', code: 'vault_unconfigured' })
          patch.password_enc = encryptSecret(password, key)
          logged.password_set = true
        } else {
          patch.password_enc = null
          logged.password_cleared = true
        }
      }

      try {
        await database('email_accounts').where('id', existing.id).update(patch)
      } catch (err) {
        if (String(err.message || '').includes('email_accounts_address_key')) {
          return res.status(409).json({ error: 'That address is already in the list', code: 'duplicate_address' })
        }
        throw err
      }

      // Re-selected rather than RETURNING-ed: `has_password` is a computed
      // expression and knex's .returning() takes column names, so building it
      // there would either be silently dropped or dialect-specific.
      const updated = await database('email_accounts')
        .where('id', existing.id)
        .first([...LIST_COLUMNS, database.raw('(password_enc IS NOT NULL) AS has_password')])

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'email_accounts',
        recordId: existing.id,
        data: { address: existing.address, ...logged },
      })

      res.json({ account: updated })
    } catch (err) {
      log.error?.({ msg: `email-accounts update: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Could not save the account' })
    }
  })

  // ── Delete ─────────────────────────────────────────────────────
  router.delete('/email-accounts/:id', async (req, res) => {
    try {
      const who = await requireGlobal(req, res)
      if (!who) return

      const existing = await scopedRow(req.params.id, who, ['id', 'address'])
      if (!existing) return res.status(404).json({ error: 'Not found' })

      await database('email_accounts').where('id', existing.id).del()

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'delete',
        collection: 'email_accounts',
        recordId: existing.id,
        data: { address: existing.address },
      })

      res.json({ deleted: existing.id })
    } catch (err) {
      log.error?.({ msg: `email-accounts delete: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Could not delete the account' })
    }
  })

  // ── Migadu sweep ───────────────────────────────────────────────
  /**
   * Ask Migadu which mailboxes actually exist on each kscw.ch domain and reconcile
   * the list. Passwords are NEVER touched — Migadu does not return them (they are
   * hashed on their side), so this only ever answers "which accounts exist", which
   * is exactly the half a human keeps forgetting to write down.
   *
   * ⚠ Rows are deactivated, not deleted, when Migadu stops reporting them: a
   * disappearing mailbox is usually a renamed domain in MIGADU_DOMAINS, and
   * deleting would take the stored password with it.
   */
  router.post('/email-accounts/sync-migadu', async (req, res) => {
    try {
      const who = await requireGlobal(req, res)
      if (!who) return

      const user = process.env.MIGADU_API_USER
      const apiKey = process.env.MIGADU_API_KEY
      if (!user || !apiKey) {
        return res.status(503).json({ error: 'The Migadu API credentials are not configured on this server', code: 'migadu_unconfigured' })
      }

      const domains = (process.env.MIGADU_DOMAINS || DEFAULT_MIGADU_DOMAINS.join(','))
        .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)

      const auth = 'Basic ' + Buffer.from(`${user}:${apiKey}`).toString('base64')
      const seen = []
      const domainErrors = []

      for (const domain of domains) {
        try {
          const r = await fetch(`${MIGADU_API}/domains/${encodeURIComponent(domain)}/mailboxes`, {
            headers: { Authorization: auth, Accept: 'application/json' },
            signal: AbortSignal.timeout(20000),
          })
          if (!r.ok) {
            // ⚠ A wrong API *host* also answers 404 with no WWW-Authenticate, so a
            // 404 here is "this domain has no mailboxes OR the credential is wrong"
            // — reported per domain rather than failing the whole sweep, because a
            // domain the club does not own is a normal entry in a default list.
            domainErrors.push({ domain, status: r.status })
            continue
          }
          const body = await r.json()
          for (const box of Array.isArray(body?.mailboxes) ? body.mailboxes : []) {
            const address = normalizeAddress(box?.address || `${box?.local_part}@${domain}`)
            if (address) seen.push({ address, name: box?.name || null, domain })
          }
        } catch (err) {
          domainErrors.push({ domain, status: null, message: err.message })
        }
      }

      // Every domain failed → almost certainly the credential, not the mailboxes.
      // Refuse rather than "reconciling" an empty list into deactivating everything.
      if (seen.length === 0 && domainErrors.length === domains.length) {
        return res.status(502).json({
          error: 'Migadu returned nothing for every domain — check MIGADU_API_USER / MIGADU_API_KEY',
          code: 'migadu_unreachable',
          domains: domainErrors,
        })
      }

      const now = new Date()
      const existing = await database('email_accounts').select('id', 'address', 'migadu_managed', 'is_active')
      const byAddress = new Map(existing.map((r) => [r.address.toLowerCase(), r]))

      let added = 0
      let reactivated = 0
      for (const box of seen) {
        const row = byAddress.get(box.address)
        if (!row) {
          await database('email_accounts').insert({
            address: box.address,
            label: box.name || null,
            sport: sportForAddress(box.address),
            provider: 'migadu',
            migadu_managed: true,
            is_active: true,
            last_seen_at: now,
            created_by_name: who.name,
            updated_by_name: who.name,
          })
          added++
        } else {
          const patch = { migadu_managed: true, last_seen_at: now }
          if (!row.is_active) { patch.is_active = true; reactivated++ }
          await database('email_accounts').where('id', row.id).update(patch)
        }
      }

      // Only sweep away rows this sync owns, and only for domains that actually
      // answered — a domain that errored tells us nothing about its mailboxes.
      const answered = new Set(seen.map((b) => b.domain))
      const seenAddresses = new Set(seen.map((b) => b.address))
      let deactivated = 0
      if (answered.size > 0) {
        const stale = existing.filter((r) => (
          r.migadu_managed && r.is_active
          && answered.has(r.address.toLowerCase().split('@')[1])
          && !seenAddresses.has(r.address.toLowerCase())
        ))
        for (const row of stale) {
          await database('email_accounts').where('id', row.id).update({
            is_active: false, updated_by_name: who.name, date_updated: now,
          })
          deactivated++
        }
      }

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'sync',
        collection: 'email_accounts',
        recordId: null,
        data: { added, reactivated, deactivated, domains: [...answered], errors: domainErrors },
      })

      res.json({ added, reactivated, deactivated, found: seen.length, domains: [...answered], errors: domainErrors })
    } catch (err) {
      log.error?.({ msg: `email-accounts migadu sync: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Could not sync with Migadu' })
    }
  })
}
