/**
 * Orphan sweep for the private upload folders that are filled BEFORE the row
 * that references the file exists (audit 2026-09-28, F-09 / C1 follow-up).
 *
 *   registration docs  /kscw/registration/upload puts a file into the private
 *                      registration folder when the applicant PICKS it; the
 *                      registration row (or /registration/:id/files) references it
 *                      seconds to minutes later.
 *   form uploads       the anonymous /f/:slug page (Public create, narrowed to
 *                      ANON_UPLOAD_FOLDERS) and the member fill modal upload into
 *                      Form uploads (0e1a0387-…-0002, migration 387) on pick; the
 *                      form_submissions row references it on submit.
 *
 * Abandoned forms and re-picked files leave unreferenced files behind. Both
 * folders take anonymous uploads, so the orphans are also what an attacker would
 * fill the disk with — hence 24 h (it was 7 days for registrations), which still
 * leaves a whole day between picking a file and submitting.
 *
 * What makes this safe to run unattended — every one of these must hold for a
 * file to be deleted:
 *   1. It is IN the named folder. The folder id must be a UUID; the query is
 *      `folder = <id>`, so folder-less files (the public site's images) and every
 *      other folder are never candidates.
 *   2. Its `uploaded_on` is older than the minimum age (never less than 1 h).
 *   3. The caller's own reference check does not claim it (registration doc
 *      columns / any form_submissions.answers that CONTAINS the id as text — a
 *      deliberately broad match, so a field renamed or retyped since the answer
 *      was stored still counts as a reference).
 *   4. No Directus-registered file relation references it: every
 *      directus_relations row with related_collection = 'directus_files' is
 *      checked (M2O image/logo/photo columns, file junction tables, …), so a file
 *      someone moved into the folder while it is used elsewhere is kept.
 *   5. It is still in the folder when re-read immediately before the delete.
 * Any error in any check aborts the run before anything is deleted.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ORPHAN_MIN_AGE_HOURS = 24
/** Per run — the cron runs daily, a backlog clears over a few days. */
export const ORPHAN_SWEEP_BATCH = 500

/** Every column Directus knows to hold a directus_files id (M2O / junction). */
export async function fileRelationColumns(database) {
  const rows = await database('directus_relations')
    .where('related_collection', 'directus_files')
    .whereNotNull('many_field')
    .select('many_collection', 'many_field')
  const seen = new Set()
  const out = []
  for (const r of rows || []) {
    if (!r?.many_collection || !r?.many_field) continue
    const key = `${r.many_collection}.${r.many_field}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ table: r.many_collection, column: r.many_field })
  }
  return out
}

/** Ids among `ids` that any registered file relation references. */
export async function referencedByRelations(database, ids, columns) {
  const hit = new Set()
  for (const { table, column } of columns) {
    // knex quotes both identifiers; a relation whose column no longer exists
    // throws, which aborts the sweep (fail safe: nothing is deleted).
    const vals = await database(table).whereIn(column, ids).pluck(column)
    for (const v of vals || []) if (v != null) hit.add(String(v).toLowerCase())
  }
  return hit
}

/** Ids among `ids` that appear anywhere in any form_submissions.answers. */
export async function referencedByFormAnswers(database, ids) {
  const result = await database.raw(
    `SELECT c.id::text AS id
       FROM unnest(?::uuid[]) AS c(id)
      WHERE EXISTS (
        SELECT 1 FROM form_submissions s
         WHERE strpos(lower(s.answers::text), c.id::text) > 0
      )`,
    [ids],
  )
  const rows = Array.isArray(result) ? result : (result?.rows || [])
  return new Set(rows.map((r) => String(r.id).toLowerCase()))
}

/** Ids among `ids` that a registrations document column references. */
export function referencedByRegistrationDocs(columns) {
  return async (database, ids) => {
    const hit = new Set()
    for (const col of columns) {
      const vals = await database('registrations').whereIn(col, ids).pluck(col)
      for (const v of vals || []) if (v != null) hit.add(String(v).toLowerCase())
    }
    return hit
  }
}

/**
 * The files in `folder` older than `minAgeHours` that nothing references.
 * Pure selection — deletes nothing.
 */
export async function findFolderOrphans(database, { folder, minAgeHours = ORPHAN_MIN_AGE_HOURS, isReferenced, limit = ORPHAN_SWEEP_BATCH }) {
  if (typeof folder !== 'string' || !UUID_RE.test(folder)) throw new Error('orphan sweep: folder must be a UUID')
  if (typeof isReferenced !== 'function') throw new Error('orphan sweep: a reference check is required')
  const asked = minAgeHours == null ? ORPHAN_MIN_AGE_HOURS : Number(minAgeHours)
  const hours = Number.isFinite(asked) ? Math.max(1, asked) : ORPHAN_MIN_AGE_HOURS

  const candidates = (await database('directus_files')
    .where('folder', folder)
    .where('uploaded_on', '<', database.raw(`now() - (? * interval '1 hour')`, [hours]))
    .orderBy('uploaded_on', 'asc')
    .limit(limit)
    .pluck('id') || [])
    .map((id) => String(id).toLowerCase())
    .filter((id) => UUID_RE.test(id))
  if (candidates.length === 0) return []

  const own = await isReferenced(database, candidates)
  const rel = await referencedByRelations(database, candidates, await fileRelationColumns(database))
  return candidates.filter((id) => !own.has(id) && !rel.has(id))
}

/**
 * Find and delete the orphans of one folder. Returns the deleted ids.
 * `deleteFiles(ids)` removes the rows AND the stored bytes (FilesService.deleteMany).
 */
export async function sweepFolderOrphans(database, { deleteFiles, ...opts }) {
  const orphans = await findFolderOrphans(database, opts)
  if (orphans.length === 0) return []
  // Re-read right before deleting: only files STILL in the folder go.
  const still = new Set((await database('directus_files')
    .whereIn('id', orphans)
    .where('folder', opts.folder)
    .pluck('id') || []).map((id) => String(id).toLowerCase()))
  const ids = orphans.filter((id) => still.has(id))
  if (ids.length === 0) return []
  await deleteFiles(ids)
  return ids
}
