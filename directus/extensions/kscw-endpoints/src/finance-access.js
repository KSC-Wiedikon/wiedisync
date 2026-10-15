/**
 * Who may read and who may write the club's books — one place for every finance
 * module that has its own route file (ledger, camt, books).
 *
 *   write  = board (vorstand/admin/superuser) or the 'finance' role (treasurer)
 *   read   = write, or the 'revisor' role — the auditors the statutes elect. They
 *            see every book, receipt and report, and can never post, delete or
 *            change a setting (every non-GET route checks `write`).
 *
 * Directus admin_access (accountability.admin) passes both. Mirrors
 * canManageFinance / canReadFinance in finance.js.
 */

export const FINANCE_WRITE_ROLES = ['board', 'admin', 'superuser', 'finance']
export const FINANCE_READ_ONLY_ROLES = ['revisor']

export function parseRoles(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** Pure decision, unit-tested: { write, read } for a role list (+ admin flag). */
export function financeAccessFor(roles, isAdmin = false) {
  const write = !!isAdmin || FINANCE_WRITE_ROLES.some((r) => roles.includes(r))
  const read = write || FINANCE_READ_ONLY_ROLES.some((r) => roles.includes(r))
  return { write, read }
}

/** The acting member's finance access + name/email for actor capture. */
export async function financeActor(database, req) {
  if (req.accountability?.admin) return { write: true, read: true, ok: true, name: null, email: null, memberId: null }
  const userId = req.accountability?.user
  if (!userId) return { write: false, read: false, ok: false }
  const m = await database('members').where('user', userId).first('id', 'first_name', 'last_name', 'email', 'role')
  if (!m) return { write: false, read: false, ok: false }
  const { write, read } = financeAccessFor(parseRoles(m.role))
  return {
    write, read, ok: write,
    name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || null,
    email: m.email || null,
    memberId: m.id,
  }
}
