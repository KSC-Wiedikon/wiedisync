/**
 * Recipient-selection parsing for the club mailbox group send.
 *
 * Lives apart from scheduling-mailbox.js on purpose: that module pulls in
 * imapflow, nodemailer and busboy at import time, which makes it untestable
 * without a live mailbox. These functions are pure, and they decide WHO a mass
 * mail reaches — the one part of the feature where a silent mistake is not
 * visible in the result (a send to the wrong 300 people still reports success).
 */

/**
 * Parse the `groups` field, which arrives as a JSON array, a comma list or a
 * single `group` — multipart fields are strings, so all three shapes exist.
 */
export function parseGroupKeys(body) {
  let keys = []
  if (body.groups != null && String(body.groups) !== '') {
    if (Array.isArray(body.groups)) keys = body.groups.map(String)
    else {
      try {
        const parsed = JSON.parse(String(body.groups))
        keys = Array.isArray(parsed) ? parsed.map(String) : []
      } catch { keys = String(body.groups).split(',') }
    }
  } else if (body.group) {
    keys = [String(body.group)]
  }
  return [...new Set(keys.map(k => k.trim()).filter(Boolean))]
}

/** JSON-or-comma list of scalars, same multipart reasoning as parseGroupKeys. */
export function parseList(value) {
  if (value == null || String(value) === '') return []
  if (Array.isArray(value)) return value.map(String)
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch { return String(value).split(',') }
}

/**
 * Parse the recipient selection into AND-clauses that OR together.
 *
 * Accepts `clauses` (a JSON array of key arrays — the drill-down's shape) and
 * falls back to flat `groups`/`group`, where each key becomes its own one-key
 * clause. That fallback is what keeps every previously-built selection
 * resolving exactly as it did: N independent keys unioned.
 */
export function parseClauses(body) {
  if (body.clauses != null && String(body.clauses) !== '') {
    let raw = body.clauses
    if (!Array.isArray(raw)) {
      try { raw = JSON.parse(String(body.clauses)) } catch { raw = [] }
    }
    if (Array.isArray(raw)) {
      const out = []
      for (const c of raw) {
        const keys = [...new Set((Array.isArray(c) ? c : [c]).map(k => String(k).trim()).filter(Boolean))]
        if (keys.length) out.push(keys)
      }
      if (out.length) return out
    }
  }
  return parseGroupKeys(body).map(k => [k])
}

/**
 * Intersect a list of Sets. Empty input yields an empty Set — NOT "everyone",
 * which is the dangerous reading: a clause that resolved nothing must send to
 * nobody rather than falling through to the whole club.
 */
export function intersectSets(sets) {
  if (!sets || sets.length === 0) return new Set()
  return sets.reduce((acc, s) => new Set([...acc].filter(v => s.has(v))))
}

/** Audience keys whose meaning depends on which season's teams you look at. */
const SEASON_SCOPED_PREFIXES = ['sport:', 'fn:', 'team:']

export const SEASON_KEY_PREFIX = 'season:'

/**
 * Split a clause into its season modifier and the audiences it scopes.
 *
 * A season is NOT another audience to intersect with. "Last season" is not a
 * set of people you AND against coaches — it changes which teams the word
 * "coach" refers to. Modelling it as a set would give coaches-of-active-teams
 * who also appear on a 2025/26 roster, which is a different and much smaller
 * group than "the people who coached last season".
 *
 * Returns `{ season, keys, seasonScopable }`. `seasonScopable` is false when no
 * remaining key actually varies by season (all members, a section, a
 * qualification, former members) — the caller rejects that combination rather
 * than silently returning the unscoped audience.
 */
export function splitSeason(clauseKeys) {
  const keys = []
  let season = null
  for (const k of clauseKeys) {
    if (String(k).startsWith(SEASON_KEY_PREFIX)) {
      // Last one wins; the UI only ever offers a single season chip.
      season = String(k).slice(SEASON_KEY_PREFIX.length).trim() || null
    } else {
      keys.push(k)
    }
  }
  const seasonScopable = keys.some(k => SEASON_SCOPED_PREFIXES.some(p => String(k).startsWith(p)))
  return { season, keys, seasonScopable }
}
