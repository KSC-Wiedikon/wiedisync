// Scheduling / events / basketball value vocabulary (migration 420, phase 4 of
// the English-only DB migration). The English slugs wiedisync stores, and the
// German spellings they replaced.
//
// Dependency-free ESM like member-values.js: kscw-endpoints and kscw-hooks import
// this one copy. Every normaliser accepts the old German value too, because a
// cached pre-420 bundle may still send it (kscw-website sends the slugs since
// its v1.31.0).

const trim = (v) => String(v ?? '').trim()

// ── events.event_type ───────────────────────────────────────────────────────
export const EVENT_TYPES = ['club', 'social', 'meeting', 'tournament', 'training_weekend', 'friendly', 'other']
const EVENT_TYPE_IN = { verein: 'club', trainingsweekend: 'training_weekend', 'training weekend': 'training_weekend' }
/** The types the Public policy and /kscw/public/events serve (setup-permissions.mjs). */
export const PUBLIC_EVENT_TYPES = ['club', 'tournament']
/** 'verein' → 'club', 'trainingsweekend' → 'training_weekend'; slugs and unknown values pass through. */
export function normalizeEventType(v) {
  const s = trim(v)
  if (!s) return null
  return EVENT_TYPE_IN[s.toLowerCase()] ?? s
}

// ── game_scheduling_slots.source + team_slot_config sources ────────────────
export const SLOT_SOURCES = ['hall_slot', 'game_saturday', 'game_hall', 'game_sunday', 'manual', 'derby']
const SLOT_SOURCE_IN = { spielsamstag: 'game_saturday', spielhalle: 'game_hall', spielsonntag: 'game_sunday' }
/** 'spielsamstag' → 'game_saturday', 'spielhalle' → 'game_hall', 'spielsonntag' → 'game_sunday'. */
export function normalizeSlotSource(v) {
  const s = trim(v)
  if (!s) return null
  return SLOT_SOURCE_IN[s.toLowerCase()] ?? s
}

const parseMaybeJson = (v) => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

/**
 * game_scheduling_seasons.team_slot_config: { [teamId]: { source? , sources? } }.
 * Returns the same shape with the source slugs. Non-objects pass through.
 */
export function normalizeTeamSlotConfig(cfg) {
  const obj = parseMaybeJson(cfg)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return cfg
  const out = {}
  for (const [team, entry] of Object.entries(obj)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { out[team] = entry; continue }
    const e = { ...entry }
    if (typeof e.source === 'string') e.source = normalizeSlotSource(e.source)
    if (Array.isArray(e.sources)) e.sources = e.sources.map((s) => (typeof s === 'string' ? normalizeSlotSource(s) : s))
    out[team] = e
  }
  return out
}

// ── game_scheduling_seasons.bb_slot_config (basketball) ─────────────────────
// { version, timeslots, game_saturdays: [{date, status, note}], game_saturdays_hard,
//   max_weekends, max_weekends_crisis } — keys were spielsamstage / spielsamstage_hard.
export const GAME_SATURDAY_STATUSES = ['given', 'desired', 'uncertain', 'if_needed']
const GAME_SATURDAY_STATUS_IN = { fraglich: 'uncertain', bei_bedarf: 'if_needed' }
export function normalizeGameSaturdayStatus(v) {
  const s = trim(v)
  if (!s) return null
  return GAME_SATURDAY_STATUS_IN[s.toLowerCase()] ?? s
}

/**
 * Old keys → new keys, statuses → slugs. When a payload carries BOTH the old and
 * the new key (a stale bundle spreading a fresh row), the new key wins: the stale
 * screen never showed the list it would overwrite.
 */
export function normalizeBbSlotConfig(cfg) {
  const obj = parseMaybeJson(cfg)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return cfg
  const out = { ...obj }
  if ('spielsamstage' in out) {
    if (!('game_saturdays' in out)) out.game_saturdays = out.spielsamstage
    delete out.spielsamstage
  }
  if ('spielsamstage_hard' in out) {
    if (!('game_saturdays_hard' in out)) out.game_saturdays_hard = out.spielsamstage_hard
    delete out.spielsamstage_hard
  }
  if (Array.isArray(out.game_saturdays)) {
    out.game_saturdays = out.game_saturdays.map((s) =>
      s && typeof s === 'object' && 'status' in s ? { ...s, status: normalizeGameSaturdayStatus(s.status) } : s)
  }
  return out
}

// ── bb_tournaments.list_status (Basketplan tournament list, action column) ──
export const BB_TOURNAMENT_LIST_STATUSES = ['open', 'closed']
/**
 * Basketplan's action-column text → 'open' | 'closed' | null.
 *   'Anmelden'                                   → open
 *   'Anmeldefrist abgelaufen' / '…geschlossen' / '…voll' → closed
 * Anything else (a list row with no action yet, an unknown wording) → null:
 * "not closed", so the tournament stays pickable (bb-tournament-picks.js).
 * Slugs pass through, so the function is idempotent.
 */
export function bbTournamentListStatus(raw) {
  const s = trim(raw)
  if (!s) return null
  if (/^(open|anmelden)$/i.test(s)) return 'open'
  if (/^closed$/i.test(s) || /abgelaufen|geschlossen|voll/i.test(s)) return 'closed'
  return null
}

// ── Items-API payload normaliser (kscw-hooks) ───────────────────────────────
// Column renames of migration 420, for a cached bundle that still sends the old key.
const RENAMED_KEYS = {
  game_scheduling_seasons: { spielsamstage: 'game_saturdays' },
  basketball_team_rules: { ferien_hard: 'school_holidays_hard' },
  basketball_groups: { modus: 'mode' },
}

/** Rewrites an items-API payload in place (old keys + old values) and returns it. */
export function normalizeSchedulingPayload(collection, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const keys = RENAMED_KEYS[collection]
  if (keys) {
    for (const [oldKey, newKey] of Object.entries(keys)) {
      if (!(oldKey in payload)) continue
      if (!(newKey in payload)) payload[newKey] = payload[oldKey]
      delete payload[oldKey]
    }
  }
  if (collection === 'events' && 'event_type' in payload && payload.event_type != null) {
    payload.event_type = normalizeEventType(payload.event_type)
  }
  if (collection === 'game_scheduling_slots' && 'source' in payload && payload.source != null) {
    payload.source = normalizeSlotSource(payload.source)
  }
  if (collection === 'game_scheduling_seasons') {
    if (payload.bb_slot_config != null) payload.bb_slot_config = normalizeBbSlotConfig(payload.bb_slot_config)
    if (payload.team_slot_config != null) payload.team_slot_config = normalizeTeamSlotConfig(payload.team_slot_config)
  }
  return payload
}
