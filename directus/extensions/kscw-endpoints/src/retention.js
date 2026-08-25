/**
 * retention.js — data retention for former members.
 *
 * Deactivation means "stop processing" — the member leaves every roster and
 * every mail audience (audience.js gates on `kscw_membership_active`) — but it
 * has never meant "stop storing". The `members` row survives whole, and until
 * this file nothing in the codebase ever removed any of it: no schedule, no
 * sweep, no cron. Storage limitation (FADP Art. 6(4) / GDPR Art. 5(1)(e)) is not
 * satisfied by "forever", and an IBAN kept for expense reimbursements a year
 * after somebody left has no purpose left to serve.
 *
 * The club's decision (2026-08-25), and the only thing this file implements:
 *
 *   WHEN   12 months after `deactivated_at` (migration 335 — trigger-owned, so
 *          the clock starts no matter which path deactivated the member).
 *   WHAT   iban, ahv_nummer, phone, adresse, plz, ort, email.
 *          NOT name, birthdate, teams or dues history: the club's own record of
 *          who played when is a legitimate interest and survives.
 *   HOW    One decision per member on /admin/data-health. Never a cron — an
 *          erasure nobody reviewed is an automated decision about a person
 *          (GDPR Art. 22 / FADP Art. 21), and the whole point of this surface is
 *          that a human takes it.
 *
 * ⚠⚠ THE INVOICE SNAPSHOT IS NOT OPTIONAL. `finance_invoices` denormalises its
 * recipient (`recipient_name/_address/_zip/_city`) so the books do not depend on
 * a live `members` row — but that only holds for invoices this app ISSUED. The
 * ClubDesk-imported rows carry a name and NOTHING ELSE: measured on prod, the 7
 * members already past 12 months hold 10 invoices between them, 10 with a
 * recipient name and **0 with an address**. Clearing the member's address first
 * would leave those accounting records with no recipient address at all — an
 * erasure that quietly degrades the books. So every erase backfills the
 * recipient onto the member's invoices that lack it BEFORE clearing the source,
 * and reports how many it filled.
 *
 * ⚠ `members.email` is NOT NULL, so it cannot be cleared to NULL. It is replaced
 * with `erased-<id>@invalid` — `.invalid` is reserved by RFC 2606 and can never
 * be delivered to, and the shape matches the dev refresh's own scrub
 * (`user_<id>@devsink.invalid`). Pseudonymised, not resurrected.
 *
 * ⚠ A member who still has a LINKED LOGIN is refused, not half-erased. Clearing
 * `members.email` while `directus_users` still holds the address, the password
 * hash and the ability to authenticate is theatre. Full account removal already
 * exists and owns that job (`POST /kscw/admin/delete-member`, delete-impact.js);
 * duplicating it here would be a second auth-deletion path to keep in sync.
 * None of today's eligible cohort has one (0 of 7), and the finding reports it
 * per row rather than hiding those members from the worklist.
 *
 * ⚠ Values are NEVER written to the audit trail — only the FIELD NAMES cleared.
 * A log that records what an erasure removed has not erased it.
 */

import { writeUserLog } from './activity-log.js'

/** Months after deactivation before a former member's data comes due. */
export const RETENTION_MONTHS = 12

/** The fields an erasure clears. `null`, except where the column refuses it. */
export const RETENTION_FIELDS = ['iban', 'ahv_nummer', 'phone', 'adresse', 'plz', 'ort', 'email']

/** Address parts the invoice snapshot copies, member column → invoice column. */
const RECIPIENT_MAP = { adresse: 'recipient_address', plz: 'recipient_zip', ort: 'recipient_city' }

/** Non-deliverable stand-in for the NOT NULL email column (RFC 2606). */
const erasedEmail = (id) => `erased-${id}@invalid`

/** Which of the retention fields actually hold something on this row. */
function populatedFields(m) {
  return RETENTION_FIELDS.filter((f) => {
    const v = m[f]
    if (v === null || v === undefined || String(v).trim() === '') return false
    // An already-erased email must not keep the member on the worklist for ever.
    if (f === 'email' && String(v).trim() === erasedEmail(m.id)) return false
    return true
  })
}

export function registerRetention(router, { database, logger }) {
  const log = logger.child({ endpoint: 'retention' })

  // Superadmin only. Same gate as the ClubDesk member-sync routes: this reads
  // and then destroys personal data club-wide, which is not a sport-admin scope.
  async function superGate(req) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const m = await database('members').where('user', userId).first('role')
    if (!m) return false
    const roles = Array.isArray(m.role)
      ? m.role
      : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    return ['superuser', 'admin'].some((r) => roles.includes(r))
  }

  /**
   * Former members whose data has come due, with what each still holds.
   * Read-only. Members with nothing left to clear are omitted — this is a
   * worklist, not a census of everyone who ever left.
   */
  async function computeRetentionDue() {
    const rows = await database('members')
      .where('kscw_membership_active', false)
      .whereNotNull('deactivated_at')
      .whereRaw(`deactivated_at < now() - interval '${RETENTION_MONTHS} months'`)
      .select('id', 'first_name', 'last_name', 'deactivated_at', 'user', ...RETENTION_FIELDS)
      .orderBy(['deactivated_at', 'last_name'])

    const candidates = []
    for (const m of rows) {
      const fields = populatedFields(m)
      if (!fields.length) continue
      // How many of this member's invoices would lose their recipient address if
      // the member row were cleared without snapshotting first.
      const inv = await database('finance_invoices')
        .where('member', m.id)
        .whereRaw("NULLIF(BTRIM(COALESCE(recipient_address, '')), '') IS NULL")
        .count({ n: '*' }).first()
      candidates.push({
        member_id: m.id,
        member_name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        deactivated_at: m.deactivated_at,
        fields,
        invoices_to_snapshot: Number(inv?.n ?? 0),
        // Refused by /retention-erase — reported so the row stays visible
        // rather than silently missing from the worklist.
        has_login: m.user !== null && m.user !== undefined,
      })
    }
    // Ex-members whose departure nobody has dated cannot be assessed at all.
    // Counted, never guessed at: a NULL clock is a human's job, not a default.
    const undated = await database('members')
      .where('kscw_membership_active', false).whereNull('deactivated_at')
      .count({ n: '*' }).first()

    return {
      candidates,
      undated: Number(undated?.n ?? 0),
      retention_months: RETENTION_MONTHS,
      fields: RETENTION_FIELDS,
    }
  }

  router.get('/retention-due', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      return res.json(await computeRetentionDue())
    } catch (err) {
      log.error({ msg: `retention-due: ${err.message}`, endpoint: 'retention-due', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/retention-erase', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const memberId = Number(req.body?.member_id)
      if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'member_id required' })

      const m = await database('members').where('id', memberId)
        .first('id', 'kscw_membership_active', 'deactivated_at', 'user', ...RETENTION_FIELDS)
      if (!m) return res.status(404).json({ error: 'Member not found' })

      // Re-derive eligibility server-side rather than trusting the list the
      // caller clicked — this destroys data, and a Data Health scan can be old.
      if (m.kscw_membership_active !== false) {
        return res.status(409).json({ error: 'Member is active — erasure applies to former members only', code: 'still_active' })
      }
      if (!m.deactivated_at) {
        return res.status(409).json({ error: 'This departure has no date, so no retention period has started', code: 'undated' })
      }
      const dueAt = new Date(m.deactivated_at)
      dueAt.setMonth(dueAt.getMonth() + RETENTION_MONTHS)
      if (dueAt > new Date()) {
        return res.status(409).json({ error: 'Not yet due', code: 'not_due', due_at: dueAt.toISOString() })
      }
      if (m.user) {
        return res.status(409).json({
          error: 'This member still has a login — remove the account in the Data Explorer instead of clearing fields',
          code: 'has_login',
        })
      }
      const fields = populatedFields(m)
      if (!fields.length) {
        return res.status(409).json({ error: 'Nothing left to clear', code: 'already_erased' })
      }

      // ⚠⚠ Snapshot BEFORE clearing. Only fills what is missing, and only from
      // what this member's row actually holds — never invents an address.
      let snapshotted = 0
      const patch = {}
      for (const [src, dst] of Object.entries(RECIPIENT_MAP)) {
        const v = m[src] === null || m[src] === undefined ? '' : String(m[src]).trim()
        if (v) patch[dst] = v
      }
      if (Object.keys(patch).length) {
        snapshotted = await database('finance_invoices')
          .where('member', memberId)
          .whereRaw("NULLIF(BTRIM(COALESCE(recipient_address, '')), '') IS NULL")
          .update(patch)
      }

      const clear = {}
      for (const f of fields) clear[f] = f === 'email' ? erasedEmail(memberId) : null
      await database('members').where('id', memberId).update(clear)

      // ⚠ Field NAMES only. Logging the values would un-erase them here.
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'members', recordId: memberId,
        data: {
          kind: 'retention_erase',
          fields_cleared: fields,
          retention_months: RETENTION_MONTHS,
          invoices_snapshotted: snapshotted,
        },
      })
      return res.json({
        success: true, member_id: memberId,
        fields_cleared: fields, invoices_snapshotted: snapshotted,
      })
    } catch (err) {
      log.error({ msg: `retention-erase: ${err.message}`, endpoint: 'retention-erase', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })
}
