// src/utils/kantonsschulen.ts
//
// The Zurich Kantonsschulen offered for `members.kantonsschule` (migration 315).
//
// KSC Wiedikon is Kantonsschule Wiedikon's club, so which Mittelschule a member
// attends is a membership fact — the club is asked for these numbers. It is
// collected on the public signup form and, since migration 315, editable by the
// member themselves and by admins.
//
// ⚠ SUGGESTIONS, NOT A GATE. There is deliberately no CHECK constraint behind
// the column: this list mirrors one on the public website (kscw-website
// `weiteres/anmeldung.astro` → KS_OTHER) that changes whenever a Zurich school
// is added, renamed or split — 'KS Rämibühl' is three entries here and one
// legacy row on prod. Every picker built on this list must therefore keep an
// existing off-list value selectable rather than force it to be overwritten.
//
// ⚠ Keep in step with THREE other copies: the website form, the Directus
// dropdown choices in migration 315, and MEMBER_SELECT_FIELDS.kantonsschule in
// `src/modules/admin/components/memberFieldOptions.ts` (which imports this).
// Adding a school to only one of them makes it enterable in one surface and
// unrecognised in the next.

/** 'KS Wiedikon' first — it is the club's own school and by far the common answer. */
export const KANTONSSCHULEN: readonly string[] = [
  'KS Wiedikon',
  'KS Birch',
  'KS Büelrain',
  'KS Bülach',
  'KS Dübendorf',
  'KS Enge',
  'KS Freudenberg',
  'KS Hohe Promenade',
  'KS Hottingen',
  'KS Im Lee',
  'KS Küsnacht',
  'KS Limmattal',
  'KS Oerlikon',
  'KS Rämibühl (Literargymnasium)',
  'KS Rämibühl (MN-Gymnasium)',
  'KS Rämibühl (Realgymnasium)',
  'KS Riesbach',
  'KS Rychenberg',
  'KS Stadelhofen',
  'KS Uetikon am See',
  'KS Uster',
  'KS Wetzikon',
  'KS Zimmerberg',
  'KS Zürich Nord',
  'Liceo Artistico',
  'Andere Kantonsschule',
]

/**
 * The stored "asked, and not at a Kantonsschule" answer.
 *
 * ⚠ Distinct from NULL, which means "never asked" — most of the club, because
 * the signup form postdates them. Collapsing the two would turn "we have not
 * asked 681 people" into "681 people are not at a Kantonsschule".
 */
export const KANTONSSCHULE_NONE = 'Nein'
