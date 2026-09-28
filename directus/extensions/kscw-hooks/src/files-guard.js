/**
 * Anonymous `directus_files` LISTING guard (website audit 2026-09-28, F-03).
 *
 * The Public policy keeps two field-scoped `directus_files` read rows (the
 * Public images folder, and the 2-minute anonymous upload read-back — see
 * setup-permissions.mjs). A row filter decides WHICH files a caller may read,
 * but nothing stopped an anonymous caller from enumerating them:
 * `GET /files?limit=-1` listed every public image plus every anonymous upload
 * of the last two minutes (a feedback screenshot, a public-form file answer)
 * to anyone, without knowing a single id.
 *
 * This refuses an anonymous `files.query` unless the query is PINNED to
 * explicit ids — i.e. the caller already holds the UUID, which is exactly the
 * capability `/assets/<id>` grants anyway. Everything legitimate is pinned:
 *
 *   • POST /files reads the new row back with `readOne(key)` / `readMany(keys)`
 *     (controllers/files.js), which Directus turns into `{ id: { _eq: key } }`
 *     resp. `{ _and: [{ id: { _in: keys } }, …] }` (services/items.js) — so the
 *     anonymous upload read-back keeps its id and the feedback/public-form
 *     uploads keep working.
 *   • GET /files/<id> is the same readOne.
 *   • /assets/<id> never reaches this event: AssetsService checks the Public
 *     read row with validateItemAccess and reads the record through a service
 *     without accountability. Nested file fields in /items reads are resolved in
 *     the AST runner and emit no `files.query` either.
 *
 * Logged-in users and admins are untouched (their own policies scope them), as
 * are internal calls with no accountability at all.
 */
import { forbiddenError } from './directus-error.js'

const MAX_PINNED_IDS = 100

function pinsId(clause) {
  if (!clause || typeof clause !== 'object' || Array.isArray(clause)) return false
  const id = clause.id
  if (!id || typeof id !== 'object' || Array.isArray(id)) return false
  if (typeof id._eq === 'string' || typeof id._eq === 'number') return true
  return Array.isArray(id._in) && id._in.length > 0 && id._in.length <= MAX_PINNED_IDS
}

/** True when the query's filter restricts it to explicit primary keys. Only a
 *  top-level `id` clause or an entry of a top-level `_and` pins — both are
 *  AND-ed with everything else, whereas an `_or` branch pins nothing. */
export function isPinnedFileQuery(query) {
  const filter = query?.filter
  if (pinsId(filter)) return true
  return Array.isArray(filter?._and) && filter._and.some(pinsId)
}

export function isAnonymous(accountability) {
  return !!accountability && !accountability.user && !accountability.admin
}

export function guardAnonymousFileQuery(query, context) {
  if (!isAnonymous(context?.accountability)) return query
  if (isPinnedFileQuery(query)) return query
  throw forbiddenError('Listing files requires a login.')
}

export function registerFilesGuard(filter) {
  filter('files.query', async (query, _meta, context) => guardAnonymousFileQuery(query, context))
}
