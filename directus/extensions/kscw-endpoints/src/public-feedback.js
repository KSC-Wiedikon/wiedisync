/**
 * Website feedback — public submission endpoint.
 *
 *   POST /kscw/public/feedback
 *     multipart/form-data (or JSON without a screenshot):
 *       type, title, description, source, status, source_url, name, email,
 *       screenshot (optional file, repeatable up to MAX_SHOTS)
 *     Turnstile token: `X-Turnstile-Token` header (what kscw-website's
 *       public/js/feedback-form.js sends) or a `turnstile_token` field.
 *     → { ok: true }
 *
 * WHY THIS EXISTS (2026-09-28 website audit, F-08)
 * -------------------------------------------------
 * The website form posted its FormData to core `/items/feedback`. That controller only
 * parses JSON, so every field — title, description, email, screenshot — arrived as an
 * empty body and the report never reached triage. The screenshot path was worse: the
 * two-step "anonymous POST /files, then /items" flow left an unfiled file behind
 * whenever the second step failed, because the quarantine hook only fires on a
 * feedback create/update (publicly readable until the deep audit's 387/388
 * allow-list; since then it sits in the private upload quarantine).
 *
 * Here the screenshot is sniffed and written straight into the private feedback folder
 * BEFORE the row exists, and deleted again if the row cannot be created. Same shape as
 * volley-feedback.js: one fail-closed Turnstile check, a per-IP limiter, an explicit
 * column allow-list, and caps on every length.
 *
 * `status` and `source` are NOT taken from the client: every row starts as
 * status='new', source='website'. `user` is never set — this door is anonymous.
 */

import {
  sniffUpload, IMAGE_TYPES, safeFilename, createLimiter, overDailyBudget,
  parseMultipart, ensureFolder, storeBuffer, verifyTurnstile,
} from './public-upload.js'

// Created by migration 074 with this fixed UUID on every environment; kscw-hooks'
// quarantine uses the same id, and it is in setup-permissions.mjs PRIVATE_FOLDERS.
export const FEEDBACK_FILES_FOLDER = 'feedbac0-0000-4000-8000-000000000001'

const TYPES = new Set(['bug', 'feature', 'feedback'])
const MAX_SHOT_BYTES = 5 * 1024 * 1024 // what the form itself enforces
const MAX_SHOTS = 3
const DAILY_BUDGET_BYTES = Number(process.env.FEEDBACK_UPLOAD_DAILY_BYTES) || 200 * 1024 * 1024

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/**
 * Build the row from untrusted fields. Pure; exported for the unit test.
 * Returns `{ row }` or `{ error }`.
 */
export function buildFeedbackRow(body) {
  const b = body || {}
  const title = str(b.title, 255)
  const description = str(b.description, 5000)
  if (!title || !description) return { error: 'title_and_description_required' }

  let sourceUrl = str(b.source_url, 255)
  if (sourceUrl) {
    try {
      const u = new URL(sourceUrl)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') sourceUrl = null
    } catch { sourceUrl = null }
  }
  const email = str(b.email, 255)
  return {
    row: {
      type: TYPES.has(b.type) ? b.type : 'feedback',
      title,
      description,
      source: 'website',
      status: 'new',
      source_url: sourceUrl,
      name: str(b.name, 100)?.replace(/[\r\n\t]/g, ' ') ?? null,
      email: email && EMAIL_RE.test(email) && !/[\r\n\t]/.test(email) ? email : null,
    },
  }
}

const reqLimiter = createLimiter(5, 60 * 60 * 1000) // 5 reports / hour / IP

export function registerPublicFeedback(router, ctx) {
  const { database, logger, services, getSchema } = ctx
  const log = logger.child({ endpoint: 'public-feedback' })

  router.post('/public/feedback', async (req, res) => {
    const stored = []
    try {
      if (!reqLimiter.take(req)) return res.status(429).json({ error: 'rate_limited' })

      const isMultipart = /^multipart\/form-data/i.test(String(req.headers['content-type'] || ''))
      let fields = req.body && typeof req.body === 'object' ? req.body : {}
      let files = []
      if (isMultipart) {
        if (Number(req.headers['content-length'] || 0) > MAX_SHOTS * MAX_SHOT_BYTES + 256 * 1024) {
          return res.status(413).json({ error: 'too_large' })
        }
        ;({ fields, files } = await parseMultipart(req, {
          fileFields: ['screenshot', 'screenshots'], maxFiles: MAX_SHOTS, maxFileBytes: MAX_SHOT_BYTES,
        }))
      }

      const token = req.headers['x-turnstile-token'] || fields.turnstile_token
      if (!(await verifyTurnstile(typeof token === 'string' ? token : ''))) {
        return res.status(400).json({ error: 'captcha_failed' })
      }

      const built = buildFeedbackRow(fields)
      if (built.error) return res.status(400).json({ error: built.error })

      // Sniff every screenshot before storing any: one bad file refuses the lot, so
      // nothing is left behind by a half-accepted submission.
      const shots = []
      for (const f of files) {
        const type = sniffUpload(f.content)
        if (!type || !IMAGE_TYPES.has(type)) return res.status(415).json({ error: 'unsupported_type' })
        shots.push({ ...f, type })
      }
      if (shots.length) {
        const total = shots.reduce((n, f) => n + f.content.length, 0)
        if (await overDailyBudget(database, FEEDBACK_FILES_FOLDER, total, DAILY_BUDGET_BYTES)) {
          log.warn({ msg: 'feedback screenshot budget exhausted — storing report without screenshots', bytes: total })
          shots.length = 0
        } else {
          await ensureFolder(database, FEEDBACK_FILES_FOLDER, 'feedback-screenshots')
        }
      }
      for (const s of shots) {
        stored.push(await storeBuffer(ctx, s.content, {
          folder: FEEDBACK_FILES_FOLDER, // ⚠ never null — see header
          filename: safeFilename(s.filename, s.type, 'screenshot'),
          type: s.type,
          title: 'Feedback screenshot',
        }))
      }

      const row = { ...built.row, date_created: new Date().toISOString() }
      if (stored.length) {
        row.screenshot = stored[0]
        row.screenshots = stored
      }

      // ItemsService, not a raw insert, so the row goes through Directus's own field
      // handling AND emits the normal feedback.items.create event — any Flow on that
      // event (the feedback → GitHub issue automation is "triggered by Directus Flow",
      // see /admin/feedback-to-github) must keep firing for website reports, which
      // `emitEvents: false` would have silently skipped.
      // No accountability is passed, so this is an internal (sudo) create: the
      // kscw-hooks Turnstile filter skips it (`!context.accountability`) instead of
      // running a second siteverify on the spent single-use token, and the
      // screenshot quarantine is a no-op (no actor; the files are born private).
      // ⚠ That skip ships in the same change as this route — deploy both extensions.
      const { ItemsService } = services
      const items = new ItemsService('feedback', { schema: await getSchema(), knex: database })
      await items.createOne(row)

      log.info({ msg: 'website feedback submitted', type: row.type, screenshots: stored.length })
      return res.json({ ok: true })
    } catch (err) {
      // A row that never got created must not leave its screenshots behind.
      if (stored.length) {
        try {
          const { FilesService } = services
          await new FilesService({ schema: await getSchema(), knex: database }).deleteMany(stored)
        } catch (cleanupErr) {
          log.warn({ msg: `feedback screenshot cleanup failed: ${cleanupErr.message}`, files: stored })
        }
      }
      if (err.status === 413) return res.status(413).json({ error: 'too_large' })
      if (err.status === 400) return res.status(400).json({ error: 'bad_request' })
      log.error({ msg: `public/feedback: ${err.message}`, stack: err.stack })
      if (!res.headersSent) res.status(500).json({ error: 'internal' })
    }
  })
}
