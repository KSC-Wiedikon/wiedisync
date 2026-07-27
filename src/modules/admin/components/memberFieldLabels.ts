// src/modules/admin/components/memberFieldLabels.ts
//
// Display names for `members` columns, shared by every admin surface that
// prints a column name at a human — the Data Explorer's field list and the
// ClubDesk sync-up modal's change chips (which showed the raw
// "federation_of_origin" until 2026-07-26).
//
// Its own module rather than an export from ExplorerMemberFields.tsx: a
// component file that also exports constants breaks React Fast Refresh
// (react-refresh/only-export-components, an ESLint *error* here).

// Human-readable labels for the `members` collection. Anything not in this
// map falls back to humanize(key) (snake_case → "Sentence case").
// Sentence case only (per CLAUDE.md capitalisation rule).
export const MEMBER_FIELD_LABELS: Record<string, string> = {
  // Identity
  id: 'ID',
  first_name: 'First name',
  last_name: 'Last name',
  nickname: 'Nickname',
  email: 'Email address',
  phone: 'Phone number',
  sex: 'Sex',
  birthdate: 'Birthdate',
  birthdate_visibility: 'Birthdate visibility',
  language: 'Preferred language',
  photo: 'Profile photo',
  number: 'Jersey number',
  position: 'Position',
  role: 'Roles',
  user: 'Directus user (UUID)',
  // Membership / activity
  kscw_membership_active: 'KSCW membership active',
  wiedisync_active: 'Wiedisync active',
  shell: 'Shell account',
  shell_expires: 'Shell expires',
  shell_reminder_sent: 'Shell reminder sent',
  requested_team: 'Requested team',
  coach_approved_team: 'Coach-approved team',
  is_spielplaner: 'Is Spielplaner',
  // Licence (Swiss Volley / sport governing body)
  license_nr: 'Licence number',
  licence_activated: 'Licence activated',
  licence_validated: 'Licence validated',
  licence_category: 'Licence category',
  licence_activation_date: 'Licence activation date',
  licence_validation_date: 'Licence validation date',
  scorer_vb: 'Scorer (volleyball)',
  referee_vb: 'Referee (volleyball)',
  otr1_bb: 'OTR1 (basketball)',
  otr2_bb: 'OTR2 (basketball)',
  // otn_bb predates the levels and stays as the coarse "holds some OTN" flag —
  // labelled so an admin does not mistake it for a third level (migration 228).
  otn_bb: 'OTN, any level (basketball, legacy)',
  otn1_bb: 'OTN 1 (basketball)',
  otn2_bb: 'OTN 2 (basketball)',
  referee_bb: 'Referee (basketball)',
  // Consent / privacy
  consent_decision: 'Consent decision',
  consent_prompted_at: 'Consent prompted at',
  hide_phone: 'Hide phone number',
  hide_email: 'Hide email address',
  website_visible: 'Visible on public website',
  push_preview_content: 'Allow push notification previews',
  // Communications
  communications_team_chat_enabled: 'Team chat enabled',
  communications_dm_enabled: 'Direct messages enabled',
  communications_banned: 'Banned from communications',
  last_online_at: 'Last online at',
  // Address / Swiss Volley admin
  adresse: 'Street address',
  plz: 'Postal code',
  ort: 'City',
  nationalitaet_codes: 'Nationality',
  nationalitaet: 'Nationality (ClubDesk name, derived)',
  federation_of_origin: 'Federation of origin',
  vm_email: 'Swiss Volley VM email',
  ahv_nummer: 'AHV number',
  beitragskategorie: 'Membership fee category',
  // Not a `members` column — a ClubDesk drift field derived from the roster
  // (guest on some team, core on none). Labelled here because the sync-up
  // modal's change chips render whatever field name the drift flag wrote.
  gast: 'Guest (ClubDesk)',
  // System
  status: 'Record status',
  date_created: 'Created at',
  date_updated: 'Updated at',
  user_created: 'Created by',
  user_updated: 'Updated by',
  sort: 'Sort order',
}

