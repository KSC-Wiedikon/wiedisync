/**
 * KSCW Directus Schema Setup
 *
 * Creates all collections and fields for the KSCW platform.
 * Run with: node scripts/setup-schema.mjs
 *
 * Requires Directus running at http://localhost:8055
 */

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) { console.error('Missing ADMIN_PASSWORD env var'); process.exit(1) }

// ── Helpers ──────────────────────────────────────────────────────────

async function getToken() {
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`)
  const { data } = await res.json()
  return data.access_token
}

async function api(token, method, path, body) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) {
    // Ignore "already exists" errors
    if (text.includes('already exists')) {
      console.log(`  ⤳ already exists, skipping`)
      return null
    }
    throw new Error(`${method} ${path}: ${res.status} ${text}`)
  }
  return text ? JSON.parse(text) : null
}

async function createCollection(token, collection, meta = {}) {
  console.log(`\n📦 Creating collection: ${collection}`)
  return api(token, 'POST', '/collections', {
    collection,
    schema: {},
    meta: { icon: 'box', ...meta },
  })
}

async function createField(token, collection, field) {
  const name = field.field
  process.stdout.write(`  + ${name}`)
  const result = await api(token, 'POST', `/fields/${collection}`, field)
  if (result) console.log(` ✓`)
  return result
}

// ── Field builder helpers ────────────────────────────────────────────

const string = (field, opts = {}) => ({
  field,
  type: 'string',
  schema: { max_length: 255, is_nullable: true, ...opts.schema },
  meta: { interface: 'input', ...opts.meta },
})

const text = (field, opts = {}) => ({
  field,
  type: 'text',
  schema: { is_nullable: true, ...opts.schema },
  meta: { interface: 'input-multiline', ...opts.meta },
})

const integer = (field, opts = {}) => ({
  field,
  type: 'integer',
  schema: { is_nullable: true, default_value: opts.default ?? null, ...opts.schema },
  meta: { interface: 'input', ...opts.meta },
})

const float = (field, opts = {}) => ({
  field,
  type: 'float',
  schema: { is_nullable: true, ...opts.schema },
  meta: { interface: 'input', ...opts.meta },
})

const boolean = (field, opts = {}) => ({
  field,
  type: 'boolean',
  schema: { default_value: opts.default ?? false, is_nullable: false, ...opts.schema },
  meta: { interface: 'boolean', ...opts.meta },
})

const datetime = (field, opts = {}) => ({
  field,
  type: 'timestamp',
  schema: { is_nullable: true, ...opts.schema },
  meta: { interface: 'datetime', ...opts.meta },
})

const date = (field, opts = {}) => ({
  field,
  type: 'date',
  schema: { is_nullable: true, ...opts.schema },
  meta: { interface: 'datetime', ...opts.meta },
})

const time = (field, opts = {}) => ({
  field,
  type: 'time',
  schema: { is_nullable: true, ...opts.schema },
  meta: { interface: 'datetime', ...opts.meta },
})

const json = (field, opts = {}) => ({
  field,
  type: 'json',
  schema: { is_nullable: true, ...opts.schema },
  meta: { interface: 'input-code', options: { language: 'json' }, ...opts.meta },
})

const select = (field, choices, opts = {}) => ({
  field,
  type: 'string',
  schema: { max_length: 255, is_nullable: true, ...opts.schema },
  meta: {
    interface: 'select-dropdown',
    options: { choices: choices.map(c => ({ text: c, value: c })) },
    ...opts.meta,
  },
})

const multiSelect = (field, choices, opts = {}) => ({
  field,
  type: 'json',
  schema: { is_nullable: true, ...opts.schema },
  meta: {
    interface: 'select-multiple-dropdown',
    options: { choices: choices.map(c => ({ text: c, value: c })) },
    ...opts.meta,
  },
})

const file = (field, opts = {}) => ({
  field,
  type: 'uuid',
  schema: { is_nullable: true, ...opts.schema },
  meta: { interface: 'file', special: ['file'], ...opts.meta },
})

// Relations are created separately after all collections exist
const m2o = (field, opts = {}) => ({
  field,
  type: 'uuid',
  schema: { is_nullable: true, ...opts.schema },
  meta: { interface: 'select-dropdown-m2o', special: ['m2o'], ...opts.meta },
})

// ── Schema Definitions ───────────────────────────────────────────────

const COLLECTIONS = [
  // ── Core ─────────────────────────────────────────────────
  {
    name: 'teams',
    meta: { icon: 'groups', color: '#4A55A2' },
    fields: [
      string('name', { schema: { is_nullable: false } }),
      string('full_name'),
      string('team_id'),
      select('sport', ['volleyball', 'basketball']),
      string('league'),
      string('season'),
      string('color'),
      boolean('active', { default: true }),
      file('team_picture'),
      string('team_picture_pos'),
      string('social_url'),
      string('bb_source_id'),
      boolean('open_for_players', { default: false }),
      json('features_enabled'),
    ],
  },
  {
    name: 'members',
    meta: { icon: 'person', color: '#4A55A2' },
    fields: [
      string('email', { schema: { is_nullable: false } }),
      string('first_name'),
      string('last_name'),
      string('phone'),
      string('license_nr'),
      integer('number'),
      multiSelect('position', [
        'setter', 'outside', 'middle', 'opposite', 'libero',
        'point_guard', 'shooting_guard', 'small_forward', 'power_forward', 'center',
        'guest', 'other',
      ]),
      file('photo'),
      multiSelect('role', ['user', 'vorstand', 'admin', 'vb_admin', 'bb_admin', 'superuser']),
      boolean('kscw_membership_active', { default: true }),
      date('birthdate'),

      // Legacy JSON column — kept for one release as a dual-read fallback.
      // Migration 069 (separate PR) drops this and the line below.
      multiSelect('licences', ['scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb']),
      // 2026-05-20 migration 067: split licences (json) into six booleans.
      boolean('scorer_vb'),
      boolean('referee_vb'),
      boolean('otr1_bb'),
      boolean('otr2_bb'),
      boolean('otn_bb'),
      boolean('referee_bb'),
      boolean('coach_approved_team'),
      select('language', ['english', 'german', 'french', 'italian', 'swiss_german']),
      boolean('hide_phone'),
      boolean('hide_email'),
      select('birthdate_visibility', ['full', 'year_only', 'hidden']),
      boolean('website_visible'),
      boolean('wiedisync_active'),
      boolean('shell'),
      datetime('shell_expires'),
      boolean('shell_reminder_sent'),
      // password_hash, verified, etc. handled by Directus auth system
    ],
  },
  {
    name: 'member_teams',
    meta: { icon: 'link' },
    fields: [
      // member and team are m2o relations, created later
      string('season'),
      integer('guest_level', { default: 0 }),
    ],
  },
  {
    name: 'team_invites',
    meta: { icon: 'mail' },
    fields: [
      string('token', { schema: { is_nullable: false } }),
      integer('guest_level', { default: 0 }),
      select('status', ['pending', 'claimed', 'expired']),
      datetime('expires_at'),
    ],
  },
  {
    name: 'halls',
    meta: { icon: 'stadium' },
    fields: [
      string('name', { schema: { is_nullable: false } }),
      string('address'),
      string('city'),
      integer('courts'),
      text('notes'),
      string('maps_url'),
      boolean('homologation'),
      string('sv_hall_id'),
    ],
  },
  {
    name: 'sponsors',
    meta: { icon: 'handshake' },
    fields: [
      string('name', { schema: { is_nullable: false } }),
      file('logo'),
      string('website_url'),
      integer('sort_order', { default: 0 }),
      boolean('active', { default: true }),
      boolean('team_page_only'),
    ],
  },

  // ── Activities ───────────────────────────────────────────
  {
    name: 'games',
    meta: { icon: 'sports_volleyball', color: '#FFC832' },
    fields: [
      string('game_id'),
      string('home_team'),
      string('away_team'),
      // kscw_team, hall are m2o relations, created later
      json('away_hall_json'),
      date('date'),
      time('time'),
      string('league'),
      string('round'),
      string('season'),
      select('type', ['home', 'away']),
      select('status', ['scheduled', 'live', 'completed', 'postponed', 'cancelled']),
      integer('home_score', { default: 0 }),
      integer('away_score', { default: 0 }),
      json('sets_json'),
      // VB + BB duty assignments are m2o relations, created later
      boolean('duty_confirmed'),
      json('referees_json'),
      select('source', ['swiss_volley', 'manual', 'basketplan']),
      datetime('respond_by'),
      integer('min_participants'),
    ],
  },
  {
    name: 'trainings',
    meta: { icon: 'fitness_center' },
    fields: [
      // team, hall_slot, hall, coach are m2o relations
      date('date'),
      time('start_time'),
      time('end_time'),
      string('hall_name'),
      text('notes'),
      boolean('cancelled'),
      text('cancel_reason'),
      datetime('respond_by'),
      integer('min_participants'),
      integer('max_participants'),
      boolean('require_note_if_absent'),
      boolean('auto_cancel_on_min'),
    ],
  },
  {
    name: 'events',
    meta: { icon: 'event' },
    fields: [
      string('title', { schema: { is_nullable: false } }),
      text('description'),
      select('event_type', ['verein', 'social', 'meeting', 'tournament', 'trainingsweekend', 'friendly', 'other']),
      datetime('start_date'),
      datetime('end_date'),
      boolean('all_day'),
      string('location'),
      // hall is m2o relation
      // teams is m2m relation (created later)
      // created_by is m2o relation
      datetime('respond_by'),
      integer('max_players'),
      integer('min_participants'),
      select('participation_mode', ['whole', 'per_day', 'per_session']),
      boolean('require_note_if_absent'),
      json('features_enabled'),
    ],
  },
  {
    name: 'rankings',
    meta: { icon: 'leaderboard' },
    fields: [
      string('team_id'),
      // team is m2o relation
      string('team_name'),
      string('league'),
      integer('rank'),
      integer('played'),
      integer('won'),
      integer('lost'),
      integer('wins_clear'),
      integer('wins_narrow'),
      integer('defeats_clear'),
      integer('defeats_narrow'),
      integer('sets_won'),
      integer('sets_lost'),
      integer('points_won'),
      integer('points_lost'),
      integer('points'),
      string('season'),
      datetime('updated_at'),
    ],
  },

  // ── Participation & RSVP ─────────────────────────────────
  {
    name: 'participations',
    meta: { icon: 'how_to_reg' },
    fields: [
      // member is m2o relation
      select('activity_type', ['training', 'game', 'event']),
      string('activity_id'),
      select('status', ['confirmed', 'declined', 'tentative', 'waitlisted']),
      text('note'),
      string('session_id'),
      integer('guest_count', { default: 0 }),
      boolean('is_staff'),
      datetime('waitlisted_at'),
    ],
  },
  {
    name: 'absences',
    meta: { icon: 'event_busy' },
    fields: [
      // member is m2o relation
      date('start_date'),
      date('end_date'),
      select('reason', ['injury', 'vacation', 'work', 'personal', 'other']),
      text('reason_detail'),
      json('affects'), // ['all', 'trainings', 'games', 'events']
      select('type', ['standard', 'weekly']),
      json('days_of_week'), // [0..6]
      boolean('indefinite'),
      boolean('blocking', { default: true }), // blocks game scheduling (migration 076)
    ],
  },

  // ── Hallenplan ───────────────────────────────────────────
  {
    name: 'hall_slots',
    meta: { icon: 'calendar_month' },
    fields: [
      // hall, team are m2o relations
      integer('day_of_week'),
      time('start_time'),
      time('end_time'),
      select('slot_type', ['training', 'game', 'event', 'away', 'other']),
      boolean('recurring', { default: true }),
      date('valid_from'),
      date('valid_until'),
      boolean('indefinite'),
      string('label'),
      text('notes'),
      select('sport', ['volleyball', 'basketball']),
    ],
  },
  {
    name: 'hall_closures',
    meta: { icon: 'block' },
    fields: [
      // hall is m2o relation
      date('start_date'),
      date('end_date'),
      string('reason'),
      select('source', ['hauswart', 'admin', 'auto', 'gcal', 'school_holidays']),
    ],
  },
  {
    name: 'slot_claims',
    meta: { icon: 'swap_horiz' },
    fields: [
      // hall_slot, hall, claimed_by_team, claimed_by_member are m2o relations
      date('date'),
      time('start_time'),
      time('end_time'),
      select('freed_reason', ['cancelled_training', 'away_game', 'manual_free']),
      string('freed_source_id'),
      text('notes'),
      select('status', ['active', 'revoked']),
    ],
  },
  {
    name: 'hall_events',
    meta: { icon: 'event_note' },
    fields: [
      string('uid'),
      string('title'),
      date('date'),
      time('start_time'),
      time('end_time'),
      string('location'),
      // hall is m2m (can be multiple halls)
      boolean('all_day'),
      string('source'),
    ],
  },

  // ── Duties & Delegations ────────────────────────────────
  {
    name: 'scorer_delegations',
    meta: { icon: 'swap_calls' },
    fields: [
      // game, from_member, to_member, from_team, to_team are m2o relations
      select('role', ['scorer', 'scoreboard', 'scorer_scoreboard', 'bb_scorer', 'bb_timekeeper', 'bb_24s_official']),
      boolean('same_team'),
      select('status', ['pending', 'accepted', 'declined', 'expired']),
    ],
  },
  {
    name: 'referee_expenses',
    meta: { icon: 'payments' },
    fields: [
      // game, team, paid_by_member, recorded_by are m2o relations
      string('paid_by_other'),
      float('amount'),
      text('notes'),
    ],
  },

  // ── Notifications & Logging ──────────────────────────────
  {
    name: 'notifications',
    meta: { icon: 'notifications' },
    fields: [
      // member is m2o relation
      select('type', [
        'activity_change', 'upcoming_activity', 'deadline_reminder',
        'result_available', 'duty_delegation_request', 'poll_created',
        'carpool_update', 'task_assigned',
      ]),
      string('title'),
      text('body'),
      select('activity_type', ['game', 'training', 'event', 'scorer_duty', 'poll', 'carpool', 'task']),
      string('activity_id'),
      // team is m2o relation
      boolean('read'),
    ],
  },
  {
    name: 'user_logs',
    meta: { icon: 'history' },
    fields: [
      // user is m2o relation
      select('action', ['create', 'update', 'delete']),
      string('collection_name'),
      string('record_id'),
      json('data'),
    ],
  },
  {
    name: 'push_subscriptions',
    meta: { icon: 'phonelink_ring' },
    fields: [
      // member is m2o relation
      text('endpoint'),
      string('keys_p256dh'),
      string('keys_auth'),
    ],
  },
  {
    name: 'email_verifications',
    meta: { icon: 'mark_email_read' },
    fields: [
      string('email'),
      string('token'),
      datetime('expires_at'),
      datetime('used_at'),
    ],
  },
  {
    name: 'app_settings',
    meta: { icon: 'settings' },
    fields: [
      string('key', { schema: { is_nullable: false } }),
      boolean('enabled'),
    ],
  },

  // ── Game Scheduling (Terminplanung) ──────────────────────
  {
    name: 'game_scheduling_seasons',
    meta: { icon: 'date_range' },
    fields: [
      string('season'),
      select('status', ['setup', 'open', 'closed']),
      json('spielsamstage'),
      json('team_slot_config'),
      json('gap_config'),
      text('notes'),
    ],
  },
  {
    name: 'game_scheduling_slots',
    meta: { icon: 'schedule' },
    fields: [
      string('season'),
      // kscw_team, hall are m2o relations
      date('date'),
      time('start_time'),
      time('end_time'),
      select('source', ['hall_slot', 'spielsamstag', 'spielhalle', 'manual']),
      select('status', ['available', 'booked', 'blocked']),
      // booking, game are m2o relations
    ],
  },
  {
    name: 'game_scheduling_opponents',
    meta: { icon: 'sports' },
    fields: [
      string('season'),
      string('club_name'),
      string('contact_name'),
      string('contact_email'),
      // kscw_team is m2o relation
      string('token'),
      // home_game, away_game are m2o relations
    ],
  },
  {
    name: 'game_scheduling_bookings',
    meta: { icon: 'book_online' },
    fields: [
      string('season'),
      // opponent is m2o relation
      select('type', ['home_slot_pick', 'away_proposal']),
      // game, slot are m2o relations
      datetime('proposed_datetime_1'),
      string('proposed_place_1'),
      datetime('proposed_datetime_2'),
      string('proposed_place_2'),
      datetime('proposed_datetime_3'),
      string('proposed_place_3'),
      integer('confirmed_proposal'),
      select('status', ['pending', 'confirmed', 'rejected']),
      text('admin_notes'),
    ],
  },

  // ── Future Features ──────────────────────────────────────
  {
    name: 'tasks',
    meta: { icon: 'task_alt' },
    fields: [
      select('activity_type', ['game', 'training', 'event']),
      string('activity_id'),
      string('label'),
      select('category', ['setup', 'equipment', 'food', 'firstAid', 'other']),
      // assigned_to, claimed_by, created_by are m2o relations
      boolean('completed'),
      datetime('completed_at'),
      integer('sort_order'),
    ],
  },
  {
    name: 'task_templates',
    meta: { icon: 'content_copy' },
    fields: [
      string('name'),
      // team is m2o relation
      json('tasks_json'),
      // created_by is m2o relation
    ],
  },
  {
    name: 'carpools',
    meta: { icon: 'directions_car' },
    fields: [
      // game, driver are m2o relations
      integer('seats_available'),
      time('departure_time'),
      string('departure_location'),
      text('notes'),
      select('status', ['open', 'full', 'cancelled']),
    ],
  },
  {
    name: 'carpool_passengers',
    meta: { icon: 'airline_seat_recline_normal' },
    fields: [
      // carpool, passenger are m2o relations
      select('status', ['confirmed', 'cancelled']),
    ],
  },
  {
    name: 'polls',
    meta: { icon: 'poll' },
    fields: [
      // team, created_by are m2o relations
      string('question'),
      json('options'),
      select('mode', ['single', 'multi']),
      datetime('deadline'),
      select('status', ['open', 'closed']),
      boolean('anonymous'),
    ],
  },
  {
    name: 'poll_votes',
    meta: { icon: 'how_to_vote' },
    fields: [
      // poll, member are m2o relations
      json('selected_options'),
    ],
  },
  {
    name: 'event_sessions',
    meta: { icon: 'view_timeline' },
    fields: [
      // event is m2o relation
      date('date'),
      time('start_time'),
      time('end_time'),
      string('label'),
      integer('sort_order'),
    ],
  },
]

// ── Relations (m2o) ──────────────────────────────────────────────────
// Format: [collection, field, related_collection]
const RELATIONS = [
  // member_teams
  ['member_teams', 'member', 'members'],
  ['member_teams', 'team', 'teams'],
  // team_invites
  ['team_invites', 'team', 'teams'],
  ['team_invites', 'invited_by', 'members'],
  ['team_invites', 'claimed_by', 'members'],
  // teams (multi-relation → use m2m junction later, for now m2o placeholders)
  // coach[], captain[], team_responsible[] are m2m — handled separately
  // games
  ['games', 'kscw_team', 'teams'],
  ['games', 'hall', 'halls'],
  ['games', 'scorer_member', 'members'],
  ['games', 'scoreboard_member', 'members'],
  ['games', 'scorer_scoreboard_member', 'members'],
  ['games', 'scorer_duty_team', 'teams'],
  ['games', 'scoreboard_duty_team', 'teams'],
  ['games', 'scorer_scoreboard_duty_team', 'teams'],
  ['games', 'bb_scorer_member', 'members'],
  ['games', 'bb_timekeeper_member', 'members'],
  ['games', 'bb_24s_official', 'members'],
  ['games', 'bb_duty_team', 'teams'],
  ['games', 'bb_scorer_duty_team', 'teams'],
  ['games', 'bb_timekeeper_duty_team', 'teams'],
  ['games', 'bb_24s_duty_team', 'teams'],
  // trainings
  ['trainings', 'team', 'teams'],
  ['trainings', 'hall_slot', 'hall_slots'],
  ['trainings', 'hall', 'halls'],
  // events
  ['events', 'hall', 'halls'],
  ['events', 'created_by', 'members'],
  // rankings
  ['rankings', 'team', 'teams'],
  // participations
  ['participations', 'member', 'members'],
  // absences
  ['absences', 'member', 'members'],
  // members
  ['members', 'requested_team', 'teams'],
  // hall_slots
  ['hall_slots', 'hall', 'halls'],
  ['hall_slots', 'team', 'teams'],
  // hall_closures
  ['hall_closures', 'hall', 'halls'],
  // slot_claims
  ['slot_claims', 'hall_slot', 'hall_slots'],
  ['slot_claims', 'hall', 'halls'],
  ['slot_claims', 'claimed_by_team', 'teams'],
  ['slot_claims', 'claimed_by_member', 'members'],
  // scorer_delegations
  ['scorer_delegations', 'game', 'games'],
  ['scorer_delegations', 'from_member', 'members'],
  ['scorer_delegations', 'to_member', 'members'],
  ['scorer_delegations', 'from_team', 'teams'],
  ['scorer_delegations', 'to_team', 'teams'],
  // referee_expenses
  ['referee_expenses', 'game', 'games'],
  ['referee_expenses', 'team', 'teams'],
  ['referee_expenses', 'paid_by_member', 'members'],
  ['referee_expenses', 'recorded_by', 'members'],
  // notifications
  ['notifications', 'member', 'members'],
  ['notifications', 'team', 'teams'],
  // user_logs
  ['user_logs', 'user', 'members'],
  // push_subscriptions
  ['push_subscriptions', 'member', 'members'],
  // game_scheduling_slots
  ['game_scheduling_slots', 'kscw_team', 'teams'],
  ['game_scheduling_slots', 'hall', 'halls'],
  ['game_scheduling_slots', 'booking', 'game_scheduling_bookings'],
  ['game_scheduling_slots', 'game', 'games'],
  // game_scheduling_opponents
  ['game_scheduling_opponents', 'kscw_team', 'teams'],
  ['game_scheduling_opponents', 'home_game', 'games'],
  ['game_scheduling_opponents', 'away_game', 'games'],
  // game_scheduling_bookings
  ['game_scheduling_bookings', 'opponent', 'game_scheduling_opponents'],
  ['game_scheduling_bookings', 'game', 'games'],
  ['game_scheduling_bookings', 'slot', 'game_scheduling_slots'],
  // tasks
  ['tasks', 'assigned_to', 'members'],
  ['tasks', 'claimed_by', 'members'],
  ['tasks', 'created_by', 'members'],
  // task_templates
  ['task_templates', 'team', 'teams'],
  ['task_templates', 'created_by', 'members'],
  // carpools
  ['carpools', 'game', 'games'],
  ['carpools', 'driver', 'members'],
  // carpool_passengers
  ['carpool_passengers', 'carpool', 'carpools'],
  ['carpool_passengers', 'passenger', 'members'],
  // polls
  ['polls', 'team', 'teams'],
  ['polls', 'created_by', 'members'],
  // poll_votes
  ['poll_votes', 'poll', 'polls'],
  ['poll_votes', 'member', 'members'],
  // event_sessions
  ['event_sessions', 'event', 'events'],
]

// M2M relations (junction tables needed)
// Format: [collection, field, related_collection, junction_collection]
const M2M_RELATIONS = [
  ['teams', 'coach', 'members', 'teams_coach'],
  ['teams', 'captain', 'members', 'teams_captain'],
  ['teams', 'team_responsible', 'members', 'teams_team_responsible'],
  ['teams', 'sponsors', 'sponsors', 'teams_sponsors'],
  ['events', 'teams', 'teams', 'events_teams'],
  ['hall_events', 'hall', 'halls', 'hall_events_halls'],
  ['hall_slots', 'teams', 'teams', 'hall_slots_teams'],
]

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('🔑 Authenticating...')
  const token = await getToken()
  console.log('✓ Authenticated\n')

  // 1. Create all collections + fields
  for (const col of COLLECTIONS) {
    try {
      await createCollection(token, col.name, col.meta)
      for (const field of col.fields) {
        await createField(token, col.name, field)
      }
    } catch (err) {
      console.error(`\n❌ Error in ${col.name}: ${err.message}`)
    }
  }

  // 2. Create M2O relation fields (create UUID field first, then relation)
  console.log('\n\n🔗 Creating M2O relations...')
  for (const [collection, field, related] of RELATIONS) {
    process.stdout.write(`  ${collection}.${field} → ${related}`)
    try {
      // Step 1: Create the integer FK field (Directus uses auto-increment integer PKs)
      await api(token, 'POST', `/fields/${collection}`, {
        field,
        type: 'integer',
        schema: { is_nullable: true },
        meta: { interface: 'select-dropdown-m2o', special: ['m2o'] },
      })
      // Step 2: Create the relation
      await api(token, 'POST', '/relations', {
        collection,
        field,
        related_collection: related,
        schema: { on_delete: 'SET NULL' },
        meta: { one_field: null, sort_field: null, one_deselect_action: 'nullify' },
      })
      console.log(' ✓')
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(' (exists)')
      } else {
        console.log(` ✗ ${err.message}`)
      }
    }
  }

  // 3. Create M2M relations (junction tables + fields + relations)
  console.log('\n\n🔗 Creating M2M relations...')
  for (const [collection, field, related, junction] of M2M_RELATIONS) {
    process.stdout.write(`  ${collection}.${field} ↔ ${related} via ${junction}`)
    try {
      // Step 1: Create the junction collection
      await createCollection(token, junction, { icon: 'link', hidden: true })

      // Step 2: Create integer FK fields on junction table
      await api(token, 'POST', `/fields/${junction}`, {
        field: `${collection}_id`,
        type: 'integer',
        schema: { is_nullable: true },
        meta: { hidden: true },
      })
      await api(token, 'POST', `/fields/${junction}`, {
        field: `${related}_id`,
        type: 'integer',
        schema: { is_nullable: true },
        meta: { hidden: true },
      })

      // Step 3: Create the M2O from junction → parent collection
      await api(token, 'POST', '/relations', {
        collection: junction,
        field: `${collection}_id`,
        related_collection: collection,
        meta: { one_field: field, junction_field: `${related}_id` },
        schema: { on_delete: 'CASCADE' },
      })

      // Step 4: Create the M2O from junction → related collection
      await api(token, 'POST', '/relations', {
        collection: junction,
        field: `${related}_id`,
        related_collection: related,
        schema: { on_delete: 'CASCADE' },
      })

      console.log(' ✓')
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(' (exists)')
      } else {
        console.log(` ✗ ${err.message}`)
      }
    }
  }

  console.log('\n\n✅ Schema setup complete!')
  console.log(`   ${COLLECTIONS.length} collections created`)
  console.log(`   ${RELATIONS.length} M2O relations created`)
  console.log(`   ${M2M_RELATIONS.length} M2M relations created`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
