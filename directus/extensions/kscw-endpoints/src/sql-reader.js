/**
 * KSCW SQL Workspace — read-only execution as the restricted reader role.
 *
 * Shared by the read mode of POST /admin/sql and the schema model behind the
 * sidebar and /admin/sql/ask, so "what the workspace may read" is decided in
 * one place: Postgres's own privileges on `kscw_sql_reader` (migration 404,
 * kept current by directus-db-role.sql). That role can SELECT every public
 * table except the credential ones and their credential columns
 * (directus_users.password/token/tfa_secret/auth_data, sessions, shares,
 * reset/verification tokens, identity documents, VM sheets, members' E2EE key
 * material and calendar token …) — none of which Directus shows even to an
 * admin.
 *
 * Two guarantees, both from the 2026-10-11 audit (H4a/H4b):
 *   - NEVER commits. knex commits a handler-style transaction as soon as the
 *     handler resolves, so a session-level `set_config(…, false)` or SET used
 *     to survive on the pooled connection and switch DB guards off for every
 *     later request. Here the transaction is always rolled back, and Postgres
 *     discards every SET / set_config made inside a rolled-back transaction.
 *   - Runs as `kscw_sql_reader` (SET LOCAL ROLE — undone by the same
 *     rollback), so a denied table or column fails with Postgres's own
 *     "permission denied", whatever the SQL text looks like.
 */

export const SQL_READER_ROLE = 'kscw_sql_reader'

function readerUnavailable(cause) {
  const err = new Error(
    `Read mode is unavailable: the database role ${SQL_READER_ROLE} is missing or not granted to this ` +
    'connection (migration 404-sql-workspace-reader-role.sql has not been applied)',
  )
  err.status = 503
  err.code = 'sql_reader_role_missing'
  err.detail = cause?.message ?? null
  return err
}

/**
 * Run `fn(trx)` in a READ ONLY transaction as {@link SQL_READER_ROLE} and roll
 * it back afterwards — on success too. Returns what `fn` returns.
 * @param {import('knex').Knex} database
 * @param {(trx: import('knex').Knex.Transaction) => Promise<any>} fn
 * @param {{ statementTimeoutMs?: number|null }} [opts]
 */
export async function withReadOnlyReader(database, fn, { statementTimeoutMs = null } = {}) {
  // No handler: knex then never commits on its own — only an explicit
  // trx.commit() would, and nothing here calls it.
  const trx = await database.transaction()
  let failed = false
  let error = null
  let result
  try {
    if (statementTimeoutMs) await trx.raw(`SET LOCAL statement_timeout = ${Number(statementTimeoutMs)}`)
    await trx.raw('SET LOCAL TRANSACTION READ ONLY')
    try {
      await trx.raw(`SET LOCAL ROLE ${SQL_READER_ROLE}`)
    } catch (err) {
      throw readerUnavailable(err)
    }
    result = await fn(trx)
  } catch (err) {
    failed = true
    error = err
  }
  try {
    await trx.rollback()
  } catch (rollbackErr) {
    // The caller's own error is the useful one; a failed ROLLBACK after it
    // (dead connection) changes nothing — the server aborts the transaction.
    if (!failed) throw rollbackErr
  }
  if (failed) throw error
  return result
}
