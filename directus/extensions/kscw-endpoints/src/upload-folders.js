/**
 * upload-folders.js — the fixed directus_folders ids (migrations 387/388) and the
 * one move every raw-knex endpoint needs to file an upload it just accepted.
 *
 * Same ids as src/lib/privateFolders.ts, kscw-hooks and setup-permissions.mjs.
 *
 * WHY THE ENDPOINTS MOVE FILES THEMSELVES
 * ---------------------------------------
 * An upload that names no folder lands in UPLOAD_QUARANTINE (388 trigger). The
 * kscw-hooks action hooks file a receipt / form answer into its private folder,
 * but only for items-API writes; /kscw/expenses/submit and /kscw/public/form-submit
 * write with raw knex, which fires no hook — so they call fileUploads() here.
 *
 * The move is deliberately narrow (a reference is client-written):
 *   - only files still at the root (folder IS NULL) or in the quarantine — never a
 *     file that already lives in another folder (a public image, a registration
 *     scan, an identity document …): naming its id must not relocate it;
 *   - only files uploaded by the named uploader — `null` means "an anonymous
 *     upload" (uploaded_by IS NULL), never "anyone's".
 */

export const EXPENSE_RECEIPTS_FOLDER = '0e1a0387-0000-4000-8000-000000000001'
export const FORM_UPLOADS_FOLDER = '0e1a0387-0000-4000-8000-000000000002'
export const PUBLIC_IMAGES_FOLDER = '0e1a0387-0000-4000-8000-000000000003'
export const UPLOAD_QUARANTINE_FOLDER = '0e1a0387-0000-4000-8000-000000000004'
export const FEEDBACK_FOLDER = 'feedbac0-0000-4000-8000-000000000001'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Move `fileIds` into `folder` when they are unfiled (root or quarantine) and were
 * uploaded by `uploadedBy` (a directus_users id, or null for anonymous uploads).
 * Returns the number of rows moved. Never throws for bad ids — they are skipped.
 */
export async function fileUploads(db, fileIds, folder, uploadedBy) {
  const ids = [...new Set((Array.isArray(fileIds) ? fileIds : [fileIds])
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => UUID_RE.test(id)))]
  if (!ids.length || !folder) return 0
  const q = db('directus_files')
    .whereIn('id', ids)
    .where((w) => w.whereNull('folder').orWhere('folder', UPLOAD_QUARANTINE_FOLDER))
  if (uploadedBy) q.where('uploaded_by', uploadedBy)
  else q.whereNull('uploaded_by')
  const n = await q.update({ folder })
  return typeof n === 'number' ? n : 0
}

/**
 * File ids named in a submission's answers, for the form's `file`-type fields only
 * (same shape rules as kscw-hooks formAnswerFileIds and migration 387): an answer
 * is `{ id, name }` or a bare id string, one value or an array of them.
 */
export function answerFileIds(fields, answers) {
  let f = fields
  if (typeof f === 'string') { try { f = JSON.parse(f) } catch { f = [] } }
  let a = answers
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch { a = {} } }
  if (!Array.isArray(f) || !a || typeof a !== 'object') return []
  const out = []
  for (const field of f) {
    if (field?.type !== 'file') continue
    const v = a[field.id]
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item && typeof item === 'object' && item.id) out.push(String(item.id))
      else if (typeof item === 'string') out.push(item)
    }
  }
  return [...new Set(out.filter((id) => UUID_RE.test(id)))]
}
