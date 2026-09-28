// ── directus_files folders (migrations 387 + 388) ───────────────────────────
//
// Fixed UUIDs so every environment, the app, kscw-hooks and setup-permissions.mjs
// agree. The directus_files read rule is an ALLOW-list: Public and Member can read
// the PUBLIC IMAGES folder and nothing else by default (plus a member's own
// uploads). Every other folder is private.
//
// ⚠ Upload rules:
//   • A PRIVATE upload (expense receipt, form file answer, …) MUST name its
//     private folder via `uploadFile(file, <FOLDER>)`, so it lands there directly
//     and the right readers (finance, form managers, the uploader) can reach it.
//   • A PUBLIC image (profile photo, team photo, sponsor logo, news/announcement
//     image) names NO folder. Migration 388 drops every folder-less upload into
//     UPLOAD_QUARANTINE, and publishes it into PUBLIC_IMAGES only once it is
//     referenced by a public image column (the uploader reads it back meanwhile).
//   • NEVER upload into PUBLIC_IMAGES directly — the 388 trigger silently keeps
//     the file out (quarantine), so the "public" upload would not be public.
//   • Migration 387 must be deployed before a build that uses these ids: the
//     upload's `folder` is a foreign key into directus_folders.

/** Expense receipts — private; read back through /kscw/expenses/:id/receipt. */
export const EXPENSE_RECEIPTS_FOLDER = '0e1a0387-0000-4000-8000-000000000001'

/** Form file answers — private; form managers (via /kscw/forms/:formId/files/:fileId) + the uploader. */
export const FORM_UPLOADS_FOLDER = '0e1a0387-0000-4000-8000-000000000002'

/** Public images (website) — the only Public-readable folder. Never upload here directly. */
export const PUBLIC_IMAGES_FOLDER = '0e1a0387-0000-4000-8000-000000000003'

/** Upload quarantine — where every folder-less upload lands until it is published. */
export const UPLOAD_QUARANTINE_FOLDER = '0e1a0387-0000-4000-8000-000000000004'

/** Feedback screenshots — private; kscw-hooks moves them here on feedback create. */
export const FEEDBACK_FOLDER = 'feedbac0-0000-4000-8000-000000000001'
