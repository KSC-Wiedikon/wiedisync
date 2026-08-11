/**
 * /kscw/site-text — admin-editable page text for the kscw-website (migration 309).
 *
 *   GET    /kscw/site-text                      — public: every override, both languages
 *   GET    /kscw/wadmin/site_text/text          — admin: the same rows plus who/when
 *   PATCH  /kscw/wadmin/site_text/text/:key     — admin: upsert one key
 *   DELETE /kscw/wadmin/site_text/text/:key     — admin: drop one key (restore the original)
 *
 * The website's dictionaries stay the source of truth; this table only shadows
 * individual keys (see 309-site-text.sql). The public GET is what the built site
 * bakes in at deploy time (scripts/fetch-site-text.mjs) and what the browser layers
 * on at runtime (public/js/i18n.js), so an edit is visible without a rebuild.
 *
 * Writes deliberately do NOT go through wadmin's generic /items/:collection CRUD:
 * `site_text` is left out of SECTION_COLLECTIONS so the only way in is this file,
 * which validates every value. All DB work is knex in the extension context —
 * the table has no Directus collection and therefore no policy to grant.
 */

import { authorize } from './wadmin.js'

const SECTION = 'site_text'

/** Same shape the table's CHECK constraint and the browser's selector guard use. */
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,119}$/

const MAX_LEN = 2000

/**
 * Vet one language's value. `null`/`''`/absent all mean "not overridden" — the
 * website falls back to its own dictionary, which is always a correct page.
 *
 * This is the *shape* authority: type, length, control characters, markup. The
 * website's build applies a second, semantic gate that this side cannot (the key
 * must exist in the dictionary, and any {placeholder} must survive the edit) —
 * only the repo holds the dictionaries needed to check that.
 */
function vetValue(raw) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'value_not_a_string' }

  const value = raw.trim()
  if (value === '') return { ok: true, value: null }
  if (value.length > MAX_LEN) return { ok: false, error: 'value_too_long' }
  // Text only. No markup path exists anywhere downstream, and the moment one is
  // added by accident a stored tag would become a stored-XSS payload that renders
  // only in English (German is escaped at build time) — invisible to a reviewer
  // clicking the site in German.
  if (value.includes('<')) return { ok: false, error: 'markup_not_allowed' }
  // Newlines/tabs collapse to nothing meaningful in a text node and make the value
  // impossible to review in a one-line admin field.
  if (/[\u0000-\u001F\u007F]/.test(value)) return { ok: false, error: 'control_characters' }

  return { ok: true, value }
}

export function registerSiteText(router, { database, logger }) {
  const log = logger || console

  // ── Public read ────────────────────────────────────────────────
  // Anonymous on purpose: this is website copy, already visible to anyone who
  // loads the page it belongs to. Shaped as { de: {key: value}, en: {…} } so both
  // the build script and the browser can merge it straight over a dictionary.
  router.get('/site-text', async (_req, res) => {
    try {
      const rows = await database('site_text').select('key', 'de', 'en')
      const out = { de: {}, en: {} }
      for (const row of rows) {
        if (row.de !== null && row.de !== undefined) out.de[row.key] = row.de
        if (row.en !== null && row.en !== undefined) out.en[row.key] = row.en
      }
      // Short: an edit has to reach visitors in seconds to be worth calling live,
      // and the payload is a few KB of text at most.
      res.set('Cache-Control', 'public, max-age=30')
      res.json(out)
    } catch (err) {
      log.error?.({ msg: `site-text read: ${err.message}`, endpoint: 'site-text', stack: err.stack })
      // An empty overlay is the correct degradation: the site renders the wording
      // it was built with rather than failing.
      res.status(200).json({ de: {}, en: {} })
    }
  })

  // ── Admin ──────────────────────────────────────────────────────
  async function guard(req, res) {
    const userId = req.accountability?.user
    if (!userId) { res.status(401).json({ error: 'unauthenticated' }); return null }
    const a = await authorize(database, userId, SECTION)
    if (!a.ok) { res.status(a.status).json({ error: a.error, section: SECTION }); return null }
    return userId
  }

  function readKey(req, res) {
    const key = String(req.params.key || '')
    if (!KEY_RE.test(key)) { res.status(400).json({ error: 'invalid_key' }); return null }
    return key
  }

  router.get('/wadmin/site_text/text', async (req, res) => {
    if (!(await guard(req, res))) return
    try {
      const rows = await database('site_text')
        .select('key', 'de', 'en', 'date_updated', 'updated_by')
      const data = {}
      for (const row of rows) data[row.key] = row
      res.json({ data })
    } catch (err) {
      log.error?.({ msg: `site-text admin read: ${err.message}`, endpoint: 'site-text', stack: err.stack })
      res.status(500).json({ error: 'internal' })
    }
  })

  // PATCH, not the PUT this upsert would otherwise want: Directus answers a
  // preflight with `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE`, so a PUT
  // from the admin page on kscw.ch (cross-origin to directus.kscw.ch) never leaves
  // the browser. Verified against dev and prod.
  router.patch('/wadmin/site_text/text/:key', async (req, res) => {
    const userId = await guard(req, res); if (!userId) return
    const key = readKey(req, res); if (!key) return

    const de = vetValue(req.body?.de)
    if (!de.ok) return res.status(400).json({ error: de.error, lang: 'de' })
    const en = vetValue(req.body?.en)
    if (!en.ok) return res.status(400).json({ error: en.error, lang: 'en' })

    try {
      // Both languages back at their default is a revert, not a row of nulls: the
      // table's CHECK would refuse it, and an admin who clears both fields means
      // "use the original". Deleting keeps "has an override" a truthful flag.
      if (de.value === null && en.value === null) {
        await database('site_text').where({ key }).del()
        return res.json({ data: null })
      }

      await database('site_text')
        .insert({ key, de: de.value, en: en.value, updated_by: userId, date_updated: database.fn.now() })
        .onConflict('key')
        .merge({ de: de.value, en: en.value, updated_by: userId, date_updated: database.fn.now() })

      res.json({ data: { de: de.value, en: en.value } })
    } catch (err) {
      log.error?.({ msg: `site-text write ${key}: ${err.message}`, endpoint: 'site-text', stack: err.stack })
      res.status(500).json({ error: 'internal' })
    }
  })

  router.delete('/wadmin/site_text/text/:key', async (req, res) => {
    if (!(await guard(req, res))) return
    const key = readKey(req, res); if (!key) return
    try {
      const removed = await database('site_text').where({ key }).del()
      // 404 tells the admin UI the key was already at its original wording, which
      // is the state Revert was asking for — it treats it as success.
      if (!removed) return res.status(404).json({ error: 'not_overridden' })
      res.json({ data: null })
    } catch (err) {
      log.error?.({ msg: `site-text delete ${key}: ${err.message}`, endpoint: 'site-text', stack: err.stack })
      res.status(500).json({ error: 'internal' })
    }
  })
}

// Exported for the unit tests — the validation rules are the security boundary here.
export const __test = { vetValue, KEY_RE, MAX_LEN }
