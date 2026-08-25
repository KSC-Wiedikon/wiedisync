/**
 * Audit hook — server-authoritative writes to `user_logs`.
 *
 * Fires after items.create / items.update / items.delete on any collection
 * NOT in SKIP_COLLECTIONS. Resolves the acting Directus user to a member id
 * and writes one row per affected key. Failures are swallowed so we never
 * block the user's primary write.
 *
 * Replaces the 48 frontend `logActivity()` calls (which are spoofable / can be
 * bypassed by anyone hitting Directus directly). Keep both running until
 * dev verifies parity, then strip the client-side calls.
 *
 * Read side: kscw-endpoints/src/audit.js (POST /kscw/admin/audit).
 */

// Collections we never log — either Directus internals, our own audit table,
// or high-write / low-signal data that would drown the log.
const SKIP_COLLECTIONS = new Set([
  'user_logs',
  'directus_activity', 'directus_revisions', 'directus_sessions',
  'directus_presence', 'directus_notifications', 'directus_flows',
  'directus_operations', 'directus_settings', 'directus_extensions',
  'error_logs', 'sync_runs', 'kscw_migrations',
  // High-volume normal traffic:
  'notifications',
  'spielplaner_assignments',
  // Machine-synced from Volleymanager nightly, and the sync PATCHes one row at a
  // time (`upsertByPersistenceId`: "Updates must go one-by-one"), so this hook
  // fired once per fixture and wrote one audit row per fixture. Measured on prod
  // 2026-08-25: 388,901 `svrz_games` + 32,012 `svrz_spielplaner_contacts` rows =
  // 96.5% of every update row in `user_logs`, 584 MB of an 861 MB table, all of it
  // "cron-service updated a fixture" repeated 3,135 times a night.
  //
  // ⚠ These are NOT unaudited — `svrz-scheduling-sync.mjs` writes ONE summary row
  //   per run (`action: 'svrz_sync'`, the same shape `gcal_sync` already uses),
  //   carrying created/updated/pruned counts. That is strictly more useful than
  //   the per-row spam: it says what the run DID, and a missing summary row is a
  //   visible "the sync did not complete" signal that 3,135 identical rows never
  //   gave. Keep the two in step — dropping the summary write would leave the
  //   nightly sync genuinely untracked.
  'svrz_games',
  'svrz_spielplaner_contacts',
  // Realtime / ephemeral:
  'messages_read_state', 'message_reactions',
])

const MAX_DATA_BYTES = 4096

// Audit 2026-05-12 #11 — collections whose payloads carry PII or secrets.
// We log the field NAMES (so an audit reviewer can see what changed) but
// redact the VALUES. The user_logs table has no PII retention story of its
// own (90-day window now enforced by `purgeUserLogs` below); these maps
// keep the per-row leak small.
const REDACTED_FIELDS = {
  members: new Set([
    'ahv_nummer', 'birthdate', 'email', 'phone', 'license_nr',
    // NB: the real column is `adresse` (German). `address` kept only as a
    // defensive alias in case a field is ever renamed.
    'address', 'adresse', 'plz', 'ort', 'anrede', 'sex',
    // Nationality + federation of origin (migrations 223/224). `nationalitaet`
    // is the trigger-derived ClubDesk name; the other two are the authoritative
    // coded columns. All three are the same PII fact — redact all three.
    'nationalitaet', 'nationalitaet_codes', 'federation_of_origin',
    'photo', 'requested_team', 'vm_email',
    'consent_decision', 'consent_prompted_at',
    // Financial PII (migrations 117 / 133 / 136) — member IBAN + the alternate
    // billing contact. Editable via items API (self-edit / finance policy), so
    // members.update payloads land in user_logs unless redacted here.
    'iban',
    'billing_name', 'billing_email', 'billing_address', 'billing_plz',
    'billing_ort', 'billing_phone', 'billing_iban',
  ]),
  directus_users: new Set([
    'email', 'password', 'token', 'tfa_secret',
    'first_name', 'last_name', 'language',
  ]),
  push_subscriptions: new Set(['endpoint', 'keys_p256dh', 'keys_auth']),
  // Whole row carries reporter-supplied free text + the message snapshot.
  reports_filed: '*',
  // Free-text member messages — never log payload values.
  messages: '*',
  message_requests: '*',
}

function redactValues(collection, payload) {
  if (payload == null || typeof payload !== 'object') return payload
  const spec = REDACTED_FIELDS[collection]
  if (!spec) return payload
  if (spec === '*') {
    const keys = Array.isArray(payload)
      ? Array.from(new Set(payload.flatMap(p => Object.keys(p || {}))))
      : Object.keys(payload)
    return { _redacted: true, _fields: keys }
  }
  const redactOne = (obj) => {
    const out = {}
    for (const k of Object.keys(obj)) {
      out[k] = spec.has(k) ? '[REDACTED]' : obj[k]
    }
    return out
  }
  return Array.isArray(payload) ? payload.map(redactOne) : redactOne(payload)
}

function summarisePayload(collection, payload) {
  if (payload == null) return null
  try {
    const redacted = redactValues(collection, payload)
    const s = JSON.stringify(redacted)
    if (s.length <= MAX_DATA_BYTES) return redacted
    return { _truncated: true, _bytes: s.length, preview: s.slice(0, MAX_DATA_BYTES) }
  } catch {
    return null
  }
}

export function registerAuditHook({ action, schedule }, { database, logger }) {
  const log = logger.child({ hook: 'audit' })

  async function resolveMemberId(directusUserId) {
    if (!directusUserId) return null
    try {
      const row = await database('members').where({ user: directusUserId }).first('id')
      return row?.id ?? null
    } catch {
      return null
    }
  }

  async function writeLog({ collection, recordId, actionType, data, accountability }) {
    if (!collection || SKIP_COLLECTIONS.has(collection)) return
    if (collection.startsWith('directus_')) return
    // Skip system / cron writes (no user) — they're traceable via container logs.
    if (!accountability?.user) return

    try {
      const memberId = await resolveMemberId(accountability.user)
      await database('user_logs').insert({
        action: actionType,
        collection_name: collection,
        record_id: recordId != null ? String(recordId) : null,
        data: data == null ? null : JSON.stringify(data),
        user: memberId,
        date_created: new Date(),
      })
    } catch (err) {
      log.warn({ msg: `audit insert failed: ${err.message}`, collection, recordId, actionType })
    }
  }

  action('items.create', async ({ collection, key, payload }, ctx) => {
    await writeLog({
      collection, recordId: key, actionType: 'create',
      data: summarisePayload(collection, payload), accountability: ctx.accountability,
    })
  })

  action('items.update', async ({ collection, keys, payload }, ctx) => {
    const data = summarisePayload(collection, payload)
    for (const k of keys || []) {
      await writeLog({
        collection, recordId: k, actionType: 'update',
        data, accountability: ctx.accountability,
      })
    }
  })

  action('items.delete', async ({ collection, keys }, ctx) => {
    for (const k of keys || []) {
      await writeLog({
        collection, recordId: k, actionType: 'delete',
        data: null, accountability: ctx.accountability,
      })
    }
  })

  // Audit 2026-05-12 #11 — purge user_logs rows older than 90 days. SECURITY.md
  // and the read endpoint both advertise a 90-day retention window; without a
  // purge, rows accumulate indefinitely (members.update payloads contain PII
  // even after `REDACTED_FIELDS` — redaction prunes values, not field names,
  // and free-text fields from other collections still leak). Runs daily at
  // 02:15 UTC. Logs the deleted row count.
  if (typeof schedule === 'function') {
    schedule('15 2 * * *', async () => {
      try {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        const deleted = await database('user_logs')
          .where('date_created', '<', cutoff)
          .delete()
        if (deleted > 0) {
          log.info(`[audit/purge] Deleted ${deleted} user_logs rows older than 90 days`)
        }
      } catch (err) {
        log.error({ msg: `[audit/purge] ${err.message}`, stack: err.stack })
      }
    })
  }

  log.info('Audit hook loaded — server-authoritative user_logs writes + 90d purge cron')
}
