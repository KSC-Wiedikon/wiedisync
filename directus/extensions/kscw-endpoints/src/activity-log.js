/**
 * Shared "who did what" writer for custom (raw-knex) endpoints.
 *
 * The kscw-hooks `items.create/update/delete` audit hook feeds `user_logs` for
 * everything that goes through the Directus items API — but custom endpoints
 * write straight to Postgres via knex, so those mutations never fire that hook
 * and would be invisible in the audit-log page. Per CLAUDE.md → "Audit logging
 * (actor capture)", every state-mutating custom endpoint calls this to record
 * the acting member + action into the same `user_logs` table the audit page
 * reads (kscw-endpoints/src/audit.js → /admin/audit-log).
 *
 * Best-effort: resolves the Directus user to a member id and inserts one row;
 * any failure is swallowed (logged) so it never blocks the primary request.
 */
export async function writeUserLog(database, log, { accountability, action, collection, recordId, data }) {
  try {
    if (!accountability?.user) return // system / unauthenticated — traceable via container logs
    const m = await database('members').where({ user: accountability.user }).first('id')
    await database('user_logs').insert({
      action: action || 'update',
      collection_name: collection || null,
      record_id: recordId != null ? String(recordId) : null,
      data: data == null ? null : JSON.stringify(data),
      user: m?.id ?? null,
      date_created: new Date(),
    })
  } catch (err) {
    try { log?.warn?.({ msg: `user_log write failed: ${err.message}`, collection, recordId }) } catch { /* ignore */ }
  }
}
