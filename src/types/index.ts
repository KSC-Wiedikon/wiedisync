export interface BaseRecord {
  id: string
  created?: string
  updated?: string
  date_created?: string
  date_updated?: string
  [key: string]: unknown
}

export type LicenceType = 'scorer_vb' | 'referee_vb' | 'otr1_bb' | 'otr2_bb' | 'otn_bb' | 'referee_bb'

/** All licence keys in canonical order — single source of truth for UI iteration. */
export const LICENCE_TYPES: readonly LicenceType[] = [
  'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb',
] as const

/** Derive the legacy LicenceType[] view from the six per-flag booleans. */
export function licencesOf(m: Partial<Record<LicenceType, boolean | undefined>>): LicenceType[] {
  const out: LicenceType[] = []
  for (const k of LICENCE_TYPES) if (m[k]) out.push(k)
  return out
}
export type MemberPosition =
  | 'setter'
  | 'outside'
  | 'middle'
  | 'opposite'
  | 'libero'
  | 'point_guard'
  | 'shooting_guard'
  | 'small_forward'
  | 'power_forward'
  | 'center'
  | 'guest'
  | 'other'

export interface Team extends BaseRecord {
  name: string
  full_name: string
  team_id: string
  sport: 'volleyball' | 'basketball'
  league: string
  season: string
  color: string
  coach: string[]
  captain: string[]
  team_responsible: string[]
  active: boolean
  team_picture: string
  team_picture_pos: string
  social_url: string
  facebook_url: string
  tiktok_url: string
  show_guests_on_website: boolean
  sponsors: string[]
  sponsors_logos: string[]
  bb_source_id: string
  open_for_players: boolean
  /** Positions the team is recruiting for (team-level). Empty/undefined = open to all. Shown on the public team page when open_for_players=true. */
  recruiting_positions?: MemberPosition[] | null
  features_enabled: TeamSettings
  /** Coach Dashboard: persisted From date (NULL = computed default). */
  dashboard_range_from?: string | null
  /** Coach Dashboard: persisted To date (NULL = today). */
  dashboard_range_to?: string | null
  /** Coach Dashboard: exclude cup games from games-attendance count. */
  dashboard_league_only?: boolean

}

export interface Sponsor extends BaseRecord {
  name: string
  logo: string
  website_url: string
  sort_order: number
  active: boolean
  teams: string[]
  team_page_only: boolean
}

export interface FeatureToggles {
  tasks?: boolean
  carpool?: boolean
  polls?: boolean
  show_rsvp_time?: boolean
  position_preferences?: boolean
}

export interface TeamSettings extends FeatureToggles {
  auto_decline_tentative?: boolean
  game_min_participants?: number
  game_respond_by_days?: number
  game_require_note_if_absent?: boolean
  training_min_participants?: number
  training_respond_by_days?: number
  training_auto_cancel_on_min?: boolean
  training_require_note_if_absent?: boolean
  /** Auto-confirm RSVP on training create (members must opt out). Default false. */
  training_auto_confirm?: boolean
  /** Auto-confirm RSVP on game create for full members only (guests blocked). Default false. */
  game_auto_confirm?: boolean
}

export interface Member extends BaseRecord {
  /** directus_users.id — set when this member has an authenticated account.
   *  Used to map participation `last_edited_by` (a directus_users UUID) back
   *  to a member name for the "Edited by …" attribution line. */
  user?: string | null
  email: string
  first_name: string
  last_name: string
  phone: string
  license_nr: string
  number: number
  position: MemberPosition[]
  photo: string
  role: ('user' | 'vorstand' | 'admin' | 'vb_admin' | 'bb_admin' | 'superuser')[]
  kscw_membership_active: boolean
  birthdate: string

  /**
   * Legacy JSON licence array. Kept for one release as a dual-read fallback
   * while consumers migrate to the per-licence boolean columns below. Will be
   * dropped by migration 069. New code should read the boolean columns
   * directly or call `licencesOf(member)`.
   */
  licences: LicenceType[]
  // 2026-05-20 migration 067: licences split into per-flag booleans.
  scorer_vb: boolean
  referee_vb: boolean
  otr1_bb: boolean
  otr2_bb: boolean
  otn_bb: boolean
  referee_bb: boolean
  coach_approved_team: boolean
  requested_team: string
  language: 'english' | 'german' | 'french' | 'italian' | 'swiss_german' | ''
  hide_phone: boolean
  hide_email: boolean
  // Per-member auto-confirm RSVP opt-in (migration 077). When on, the member is
  // auto-confirmed on new activities of that type (OR-ed with the team setting).
  auto_confirm_trainings: boolean
  auto_confirm_games: boolean
  auto_confirm_events: boolean
  birthdate_visibility: 'full' | 'year_only' | 'hidden'
  website_visible: boolean
  is_spielplaner: boolean
  wiedisync_active: boolean
  shell: boolean
  shell_expires: string
  shell_reminder_sent: boolean
  // ClubDesk sync fields
  adresse: string
  plz: string
  ort: string
  nationalitaet: string
  anrede: string
  sex: string
  licence_category: string
  licence_activated: boolean
  licence_validated: boolean
  licence_activation_date: string | null
  licence_validation_date: string | null
  vm_email: string
  ahv_nummer: string
  beitragskategorie: string

  // Messaging
  communications_team_chat_enabled?: boolean
  communications_dm_enabled?: boolean
  communications_banned?: boolean
  push_preview_content?: boolean
  last_online_at?: string | null
  consent_decision?: ConsentDecision
  consent_prompted_at?: string | null

}

export interface MemberTeam extends BaseRecord {
  member: string
  team: string
  season: string
  guest_level: number  // 0=member, 1-3=guest levels

}

export interface TeamInvite extends BaseRecord {
  token: string
  team: string
  invited_by: string
  guest_level: number // 0=player, 1-3=guest
  status: 'pending' | 'claimed' | 'expired'
  claimed_by: string
  expires_at: string

}

export interface Hall extends BaseRecord {
  name: string
  address: string
  city: string
  courts: number
  notes: string
  maps_url: string
  homologation: boolean
  sv_hall_id: string

}

export interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    name?: string
    street?: string
    housenumber?: string
    city?: string
    postcode?: string
    country?: string
    state?: string
    osm_key?: string
    osm_value?: string
  }
}

export interface LocationResult {
  name: string
  address: string
  city: string
  lat: number | null
  lon: number | null
  source: 'directus' | 'photon' | 'google'
}

export interface SlotClaim extends BaseRecord {
  hall_slot: string
  hall: string
  date: string
  start_time: string
  end_time: string
  claimed_by_team: string
  claimed_by_member: string
  freed_reason: 'cancelled_training' | 'away_game' | 'manual_free'
  freed_source_id: string
  notes: string
  status: 'active' | 'revoked'

}

export interface VirtualSlotMeta {
  source: 'game' | 'training' | 'hall_event'
  sourceId: string
  sourceRecord: Game | Training | HallEvent
  isAway?: boolean
  isCancelled?: boolean
  isFreed?: boolean
  isClaimed?: boolean
  claimRecord?: SlotClaim
  /** Spielhalle slot that is free (no game scheduled) */
  isSpielhalleFreed?: boolean
  /** Recurring training template surfaced as free for this week/day */
  isTemplateFreed?: boolean
  /** When a slot spans multiple halls (e.g. BB game in A+B), lists all hall IDs */
  spanHallIds?: string[]
}

export interface HallSlot extends BaseRecord {
  hall: string
  team: string[]
  day_of_week: number
  start_time: string
  end_time: string
  slot_type: 'training' | 'game' | 'event' | 'away' | 'other'
  recurring: boolean
  valid_from: string
  valid_until: string
  indefinite: boolean
  label: string
  notes: string
  sport?: 'volleyball' | 'basketball' | ''

  _virtual?: VirtualSlotMeta
}

export interface HallClosure extends BaseRecord {
  hall: string
  start_date: string
  end_date: string
  reason: string
  source: 'hauswart' | 'admin' | 'auto' | 'gcal' | 'school_holidays'

}

export interface Game extends BaseRecord {
  game_id: string
  home_team: string
  away_team: string
  kscw_team: string
  hall: string
  /** Extra halls this game also blocks (e.g. basketball A+B combo). Empty/null = single-hall. */
  additional_halls?: string[] | null
  away_hall_json: { name: string; address: string; city: string; plus_code?: string } | null
  date: string
  time: string
  league: string
  round: string
  season: string
  type: 'home' | 'away'
  status: 'scheduled' | 'live' | 'completed' | 'postponed' | 'cancelled'
  home_score: number
  away_score: number
  sets_json: unknown
  // Volleyball duty assignments
  scorer_member: string
  scoreboard_member: string
  scorer_scoreboard_member: string
  scorer_duty_team: string
  scoreboard_duty_team: string
  scorer_scoreboard_duty_team: string
  // Basketball duty assignments
  bb_scorer_member: string
  bb_timekeeper_member: string
  bb_24s_official: string
  bb_duty_team: string
  bb_scorer_duty_team: string
  bb_timekeeper_duty_team: string
  bb_24s_duty_team: string
  duty_confirmed: boolean
  referees_json: Array<{ name: string; id?: number }>
  source: 'swiss_volley' | 'manual' | 'basketplan'
  svrz_push_status: 'pending' | 'pushed' | 'failed' | null
  respond_by: string
  min_participants: number
  /** Per-game override for auto-confirm RSVP. null = inherit team default. */
  auto_confirm_rsvp?: boolean | null

}

export interface SpielplanerAssignment extends BaseRecord {
  member: string | number
  kscw_team: string | number
}

/**
 * Input shape for creating a manual game via the Spielplanung modal or
 * bulk-import flow. The shape is deliberately simpler than `Game` —
 * Directus fills defaults (status, source, svrz_push_status) in the
 * payload builder.
 */
export interface ManualGameInput {
  kscw_team: string | number
  type: 'home' | 'away'
  opponent: string
  date: string // 'YYYY-MM-DD'
  time: string // 'HH:MM' — 24h
  hall?: string | number | null
  /** Extra halls this home game also blocks (e.g. basketball A+B combo). */
  additional_halls?: string[] | null
  away_hall_json?: {
    name: string
    address: string
    city: string
    plus_code?: string
  } | null
  league?: string
  round?: string
  /** Per-game override for auto-confirm RSVP. null = inherit team default. */
  auto_confirm_rsvp?: boolean | null
}

export interface RefereeExpense extends BaseRecord {
  game: string
  team: string
  paid_by_member: string
  paid_by_other: string
  amount: number
  notes: string
  recorded_by: string
}


export interface Ranking extends BaseRecord {
  team_id: string
  team: string
  team_name: string
  league: string
  rank: number
  played: number
  won: number
  lost: number
  wins_clear?: number
  wins_narrow?: number
  defeats_clear?: number
  defeats_narrow?: number
  sets_won: number
  sets_lost: number
  points_won: number
  points_lost: number
  points: number
  season: string
  updated_at: string

}

export interface Training extends BaseRecord {
  team: string
  hall_slot: string
  date: string
  start_time: string
  end_time: string
  hall: string
  hall_name: string
  coach: string
  notes: string
  cancelled: boolean
  cancel_reason: string
  respond_by: string
  min_participants: number
  max_participants: number
  require_note_if_absent: boolean
  auto_cancel_on_min: boolean
  /** Guest tiers blocked from confirming/tentative on this training. Values 1-3. Empty = open to all. */
  excluded_guest_levels: number[]
  /** Per-training override for auto-confirm RSVP. null = inherit team default. */
  auto_confirm_rsvp?: boolean | null
  /** Trial training (Probetraining): publicly visible on the website when the team is open for new players. */
  is_trial?: boolean
}

export interface Absence extends BaseRecord {
  member: string
  start_date: string
  end_date: string
  reason: 'injury' | 'vacation' | 'work' | 'personal' | 'other'
  reason_detail: string
  affects: string[] // 'all', 'trainings', 'games', 'events'
  type: 'standard' | 'weekly'
  days_of_week: number[] // 0=Mon..6=Sun (only for type='weekly')
  indefinite: boolean
  /**
   * Migration 076: when true (default), this absence blocks game-scheduling
   * availability on its dates. Set false for absences where the player won't
   * play anyway (long-term injury, maternity leave) so the rest of the squad
   * can still be scheduled. Only standard absences affecting games/all count.
   */
  blocking: boolean
  /** Migration 051: directus_users.id of the most recent authenticated writer. */
  last_edited_by?: string | null
  /** Migration 051: timestamp of the most recent authenticated write. */
  last_edited_at?: string | null
  /** Migration 053: display name of the writer (first_name + last_name). */
  last_edited_name?: string | null
  /** Migration 053: writer's role relative to the affected member. */
  last_edited_role?: 'coach' | 'team_responsible' | 'admin' | 'staff' | null
}

/**
 * Migration 085: team-level game-scheduling blackout ("Team blocking").
 * A row hard-blocks game scheduling for `team` on every date in
 * [start_date, end_date] — home-slot offering AND all three away proposals —
 * like a team event but coach/TR-managed with no RSVP/chat. Created in the
 * Team Absences view; scoped to coach/TR teams (admins/Spielplaner: any team).
 */
export interface SchedulingBlock extends BaseRecord {
  team: string
  start_date: string // YYYY-MM-DD
  end_date: string // YYYY-MM-DD
  reason: string | null
  created_by: string | null
  date_created?: string
  date_updated?: string
}

export interface Event extends BaseRecord {
  title: string
  description: string
  event_type: 'verein' | 'social' | 'meeting' | 'tournament' | 'trainingsweekend' | 'friendly' | 'other'
  start_date: string
  end_date: string
  all_day: boolean
  location: string
  hall: string
  teams: string[]
  created_by: string
  respond_by: string
  max_players: number
  min_participants: number
  participation_mode: 'whole' | 'per_day' | 'per_session' | ''
  require_note_if_absent: boolean
  allow_maybe: boolean
  features_enabled: FeatureToggles
  invited_roles: string[] | null
  invited_members: string[]
  send_email_invite: boolean
  cancelled: boolean
  cancel_reason: string

}

export interface EventSession extends BaseRecord {
  event: string
  date: string
  start_time: string
  end_time: string
  label: string
  sort_order: number

}

export interface HallEvent extends BaseRecord {
  uid: string
  title: string
  date: string
  start_time: string
  end_time: string
  location: string
  hall: string[]
  all_day: boolean
  source: string
}

export type VolleyPosition = 'Setter' | 'Outside' | 'Middle' | 'Opposite' | 'Libero' | 'Universal'

export interface Participation extends BaseRecord {
  member: string
  activity_type: 'training' | 'game' | 'event'
  activity_id: string
  status: 'confirmed' | 'declined' | 'tentative' | 'waitlisted'
  note: string
  session_id: string
  guest_count: number
  is_staff: boolean
  waitlisted_at: string
  position_1?: VolleyPosition | null
  position_2?: VolleyPosition | null
  position_3?: VolleyPosition | null
  /** Set by the autoDeclineForAbsence hook when the cron writes a forced
   *  decline. Cleared to NULL by the BEFORE UPDATE trigger the moment a user
   *  changes `status` (migration 038), so a non-null marker is the definitive
   *  signal that "this row was system-set, not user-set". */
  auto_declined_by?: number | null
  /** Per-field edit attribution (migration 047). Set by the kscw-hooks
   *  `participations.items.{create,update}` filter ONLY when the matching
   *  field is in the write payload, so editing the note doesn't reset the
   *  status attribution and vice versa. Null for system-context writes
   *  (cron auto-decline, hall-closure unwind) — those leave the tracker
   *  pair untouched, distinguishing them from staff edits. Roster modal
   *  renders "Edited to X by Y on Z" / "Note edited by Y on Z" as
   *  independent lines when these resolve to a user other than the
   *  participation's own member. */
  last_status_edited_by?: string | null
  last_status_edited_at?: string | null
  last_note_edited_by?: string | null
  last_note_edited_at?: string | null
}

export interface UserLog extends BaseRecord {
  user: string
  action: 'create' | 'update' | 'delete'
  collection_name: string
  record_id: string
  data: Record<string, unknown> | null
}

export type ParticipationWithMember = Participation & {
  member: Pick<Member, 'id' | 'position'> | string
}

// ── Game Scheduling (Terminplanung) ──────────────────────────────────

export interface GameSchedulingSeason extends BaseRecord {
  season: string
  status: 'setup' | 'open' | 'closed'
  spielsamstage: SpielsamstagConfig[]
  team_slot_config: TeamSlotConfig | null
  /** Per-season game-spacing gaps in days. Null/missing → defaults {4,4,2}. */
  gap_config: GameSchedulingGapConfig | null
  notes: string

}

export interface GameSchedulingGapConfig {
  /** Min days between a home game and any other committed game. */
  home: number
  /** Same, for away proposals 1 & 2. */
  proposal: number
  /** Same, for the lenient 3rd away proposal. */
  proposal3: number
}

export interface SpielsamstagConfig {
  date: string
  slots: { time: string; hall_id: string }[]
}

/** One head-to-head leg of an intra-club derby (e.g. H1 vs H3) — Art. 27 SVRZ. */
export interface DerbyLeg {
  svrz_id: string
  display_name: string | null
  home_team: { id: number; name: string }
  away_team: { id: number; name: string }
  /** Placeholder/scheduled datetime as the SVRZ feed currently has it. */
  feed_datetime: string | null
  /** Round the feed currently files it under, e.g. "Runde 7" (the case Art. 27 overrides). */
  round: string | null
  /** Date the spielplaner fixed (YYYY-MM-DD), or null. */
  date: string | null
  half: 'vorrunde' | 'rueckrunde' | null
}

/** A detected derby pair: two KSCW teams sharing a league group + their two legs. */
export interface Derby {
  team_a: { id: number; name: string }
  team_b: { id: number; name: string }
  legs: DerbyLeg[]
  confirmed: boolean
  stored_id: number | null
}

export interface DerbiesResponse {
  season: string
  /** Vor-/Rückrunde boundary (YYYY-01-01) the halves split on. */
  boundary: string | null
  derbies: Derby[]
}

export interface TeamSlotConfig {
  [teamId: string]: {
    /** Additive home-slot sources. Empty/absent = manual (no slots generated).
     *  'hall_slot' = the team's latest Doltschi/KWI evening slots (end 21:30);
     *  'spielsamstag' = the central Game-Saturday pool. Both may be active. */
    sources?: ('hall_slot' | 'spielsamstag')[]
    /** @deprecated legacy single-select — still read for back-compat. */
    source?: 'hall_slot' | 'spielsamstag' | 'manual'
    hall_slot_id?: string
  }
}

export interface GameSchedulingSlot extends BaseRecord {
  season: string
  kscw_team: string
  date: string
  start_time: string
  end_time: string
  hall: string
  source: 'hall_slot' | 'spielsamstag' | 'spielhalle' | 'manual'
  status: 'available' | 'booked' | 'blocked'
  booking: string
  game: string

}

export type InviteStatus = 'invited' | 'viewed' | 'booked' | 'revoked' | 'expired' | 'active'
export type InviteSource = 'self_registration' | 'manual' | 'svrz'

export interface GameSchedulingOpponent extends BaseRecord {
  season: string | number | null
  club_name: string
  team_name?: string | null
  contact_name: string
  contact_email: string
  kscw_team: string
  token: string
  home_game: string
  away_game: string
  status?: InviteStatus
  source?: InviteSource
  created_by_admin?: boolean
  first_viewed_at?: string | null
  expires_at?: string | null
  /** When the opponent was last asked to pick 3 new home slots (all prior proposals invalidated). */
  new_slots_requested_at?: string | null
  /** Free-text note from KSCW shown to the opponent on their proposal page (editable in the dashboard). */
  kscw_note?: string | null
  /** Free-text remark written by the opponent (read-only for KSCW, shown in the dashboard). */
  opponent_note?: string | null
}

/** Live validity of one proposed home slot (GET /admin/terminplanung/proposal-health). */
export interface ProposalHealthProposal {
  num: number
  slot_id: number
  valid: boolean
  /** Short reason code when invalid: taken | team_event | team_block | hall_closed | too_close | derby | doltschi_cap | doltschi_taken */
  reason: string | null
}

export interface ProposalHealthEntry {
  booking_id: number
  opponent_id: number
  opponent_label: string
  kscw_team: number
  proposals: ProposalHealthProposal[]
  alive_count: number
  all_dead: boolean
}

export interface OpponentInvite {
  id: string
  team_name: string
  contact_name: string
  contact_email: string
  token: string
  kscw_team: string
  season: string | number | null
  status: InviteStatus
  source: InviteSource
  created_by_admin: boolean
  first_viewed_at: string | null
  email_sent_at?: string | null
  expires_at: string
  date_created: string
}

export interface GameSchedulingBooking extends BaseRecord {
  season: string
  opponent: string
  type: 'home_slot_pick' | 'away_proposal'
  game: string
  slot: string
  proposed_datetime_1: string
  proposed_place_1: string
  proposed_datetime_2: string
  proposed_place_2: string
  proposed_datetime_3: string
  proposed_place_3: string
  /** Home-slot proposals (slot ids) while a home booking is pending. */
  proposed_slot_1: string | number | null
  proposed_slot_2: string | number | null
  proposed_slot_3: string | number | null
  confirmed_proposal: number
  status: 'pending' | 'confirmed' | 'rejected'
  admin_notes: string
  /** VolleyManager push tracking (home_slot_pick only). */
  vm_push_status?: 'queued' | 'pushed' | 'pushed_no_hall' | 'needs_pick' | 'no_fixture' | 'failed' | null
  vm_game_id?: string | null
  vm_pushed_at?: string | null
  /** Failure message, OR a JSON {"needs_pick":[{id,label,date}]} candidate list. */
  vm_push_error?: string | null
}

export interface ScorerDelegation extends BaseRecord {
  game: string
  role: 'scorer' | 'scoreboard' | 'scorer_scoreboard' | 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official'
  from_member: string
  to_member: string
  from_team: string
  to_team: string
  same_team: boolean
  status: 'pending' | 'accepted' | 'declined' | 'expired'

}

export interface Notification extends BaseRecord {
  member: string
  type: 'activity_change' | 'upcoming_activity' | 'deadline_reminder' | 'result_available' | 'duty_delegation_request' | 'member_join_request' | 'poll_created' | 'carpool_update' | 'task_assigned' | 'event_invite' | 'new_report' | 'form_published' | 'form_submission' | 'form_reminder'
  title: string
  body: string
  activity_type: 'game' | 'training' | 'event' | 'scorer_duty' | 'team' | 'poll' | 'carpool' | 'task' | 'report' | 'form' | ''
  activity_id: string
  team: string
  read: boolean
}

// ── Announcements (Vereinsnews) ────────────────────────────────────

export type AnnouncementLocale = 'de' | 'en' | 'fr' | 'gsw' | 'it'

export interface AnnouncementTranslation {
  title: string
  /** HTML body (sanitized at render via RichText component) */
  body: string
}

export type AnnouncementAudienceType = 'all' | 'sport' | 'teams' | 'roles'

export interface Announcement extends BaseRecord {
  /** UUID of directus_files (hero image), or null */
  image: string | null
  /** Optional CTA link (external or internal). */
  link: string
  /** Sticky to top of feed when true. */
  pinned: boolean
  /** ISO timestamp; null = draft (not visible to members). */
  published_at: string | null
  /** Optional auto-hide timestamp. */
  expires_at: string | null
  audience_type: AnnouncementAudienceType
  /** When audience_type='sport' */
  audience_sport: 'volleyball' | 'basketball' | null
  /** When audience_type='teams' (schema-ready, hidden in v1 admin UI). */
  audience_teams: string[]
  /** When audience_type='roles' (schema-ready, hidden in v1 admin UI). */
  audience_roles: string[]
  /** Per-post toggle: also send web push on publish. */
  notify_push: boolean
  /** Per-post toggle: also send email on publish. */
  notify_email: boolean
  /** M2O → members.id (autofill). */
  created_by: string | null
  /** Set by backend hook after push/email fanout — prevents re-sending on edit. */
  fanout_sent_at: string | null
  /** Per-locale title + HTML body. German required. */
  translations: Partial<Record<AnnouncementLocale, AnnouncementTranslation>>
}

export type TaskCategory = 'setup' | 'equipment' | 'food' | 'firstAid' | 'other'

export interface Task extends BaseRecord {
  activity_type: 'game' | 'training' | 'event'
  activity_id: string
  label: string
  category: TaskCategory | ''
  assigned_to: string
  claimed_by: string
  completed: boolean
  completed_at: string
  sort_order: number
  created_by: string
}

export interface TaskTemplate extends BaseRecord {
  name: string
  team: string
  tasks_json: Array<{ label: string; category: TaskCategory | '' }>
  created_by: string
}

// ── Carpool ─────────────────────────────────────────────────────────────

export interface Carpool extends BaseRecord {
  game: string
  driver: string
  seats_available: number
  departure_time: string
  departure_location: string
  notes: string
  status: 'open' | 'full' | 'cancelled'
}

export interface CarpoolPassenger extends BaseRecord {
  carpool: string
  passenger: string
  status: 'confirmed' | 'cancelled'
}

// ── Polls ───────────────────────────────────────────────────────────────

export interface Poll extends BaseRecord {
  team: string | null
  conversation?: string | null
  question: string
  options: string[]
  mode: 'single' | 'multi'
  deadline: string
  created_by: string
  status: 'open' | 'closed'
  anonymous: boolean
}

export interface PollVote extends BaseRecord {
  poll: string
  member: string
  selected_options: number[]
}

// ─── Messaging ───────────────────────────────────────────────

export type ConversationType = 'team' | 'dm' | 'dm_request' | 'activity_chat' | 'group_dm'

export type ConversationActivityType = 'event'

export interface Conversation extends BaseRecord {
  type: ConversationType
  team: string | null
  title: string | null
  created_by: string
  created_at: string
  last_message_at: string | null
  last_message_preview: string | null
  /** activity_chat only — 'event' in Plan 02. */
  activity_type?: ConversationActivityType | null
  /** activity_chat only — integer FK at DB level (string in client-side JSON). */
  activity_id?: number | string | null
}

export type ConversationMemberRole = 'member' | 'moderator'

export interface ConversationMember extends BaseRecord {
  conversation: string
  member: string
  role: ConversationMemberRole
  joined_at: string
  last_read_at: string | null
  muted: boolean
  archived: boolean
}

export type MessageType = 'text' | 'poll'

export interface Message extends BaseRecord {
  conversation: string
  sender: string
  type: MessageType
  body: string | null
  poll: string | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export interface MessageReaction extends BaseRecord {
  message: string
  member: string
  emoji: string
  created_at: string
}

export interface Block extends BaseRecord {
  blocker: string
  blocked: string
  created_at: string
}

export type MessageRequestStatus = 'pending' | 'accepted' | 'declined'

export interface MessageRequest extends BaseRecord {
  conversation: string
  sender: string
  recipient: string
  status: MessageRequestStatus
  created_at: string
  resolved_at: string | null
}

export type ReportReason =
  | 'harassment' | 'spam' | 'inappropriate' | 'other' | 'moderator_delete'
export type ReportStatus = 'open' | 'resolved' | 'dismissed'

export interface Report extends BaseRecord {
  reporter: string | null
  reported_member: string | null
  message: string | null
  conversation: string | null
  reason: ReportReason
  note: string | null
  message_snapshot: string | null
  status: ReportStatus
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
}

export type ConsentDecision = 'pending' | 'declined' | 'accepted'

// ── Fines (migration 069) ───────────────────────────────────────────────

export type FineCategory = 'late_signin' | 'no_show' | 'late_payment' | 'custom'
export type FineStatus = 'open' | 'paid' | 'waived'
export type FineActivityType = 'training' | 'game' | 'event'
export type FinePayMethod = 'cash' | 'twint' | 'transfer' | 'other'
export type FinePayTo = 'team_kasse' | 'club_kasse'
export type FineResetWindow = 'calendar_month' | 'rolling_30d' | 'rolling_90d' | 'season' | 'never'

export interface FineRuleTier {
  /** Exact-match offense number. Use this OR offense_min (not both). */
  offense?: number
  /** Catch-all for "Nth offense and beyond". Use on the last tier. */
  offense_min?: number
  amount: number
}

export interface FineRule extends BaseRecord {
  team: string
  category: FineCategory
  enabled: boolean
  reset_window: FineResetWindow
  tiers: FineRuleTier[]
  currency: string
  notes?: string | null
  updated_by?: string | null
}

export interface Fine extends BaseRecord {
  member: string
  team: string
  category: FineCategory
  amount: number
  currency: string
  status: FineStatus
  activity_type: FineActivityType | null
  activity_id: string | null
  activity_date: string | null
  /** Snapshot: which Nth offense this was within the window at issue time. */
  tier_offense: number | null
  /** Snapshot: which reset_window the engine used. */
  reset_window_at_issue: FineResetWindow | null
  reason: string | null
  issued_by: string | null
  issued_at: string
  paid_at: string | null
  paid_method: FinePayMethod | null
  paid_to: FinePayTo | null
  paid_received_by: string | null
  waived_at: string | null
  waived_by: string | null
  waived_reason: string | null
  auto_issued: boolean
  notes: string | null
}
