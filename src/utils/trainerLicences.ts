// src/utils/trainerLicences.ts
//
// Coaching education (Trainerausbildung) — `members.trainer_licences`,
// migration 274. Stored exactly like `nationalitaet_codes`: an ordered,
// comma-separated code list in a single varchar, parsed on read and
// serialized on write. See src/utils/countries.ts for the same pattern.
//
// The values are NOT one ladder. J+S (Jugend+Sport Leiter/in) is the federal
// track; C/B/A is Swiss Volley's rung ladder; T1/T2/T3 ("Trainer 1/2/3",
// migration 281) is Swiss Basketball's. A member can hold several across
// tracks — "JS,B" and "JS,T2" are ordinary values — and the two sport ladders
// are NOT interchangeable: T2 is not a synonym for B.

/** Canonical order — also the order the DB trigger normalizes to. */
export const TRAINER_LICENCE_CODES = ['JS', 'C', 'B', 'A', 'T1', 'T2', 'T3'] as const
export type TrainerLicence = (typeof TRAINER_LICENCE_CODES)[number]

/**
 * Which rungs belong to which sport. J+S is deliberately in NEITHER list — it
 * is the federal leader track and applies to both, so every caller offers it
 * unconditionally. Used to narrow the profile picker to the member's own sport;
 * it is a display filter only, never a validation rule (a member may legitimately
 * hold both ladders, and the stored value must always render).
 */
export const TRAINER_LICENCE_CODES_BY_SPORT: Record<'volleyball' | 'basketball', readonly TrainerLicence[]> = {
  volleyball: ['C', 'B', 'A'],
  basketball: ['T1', 'T2', 'T3'],
}

const RANK: Record<string, number> = Object.fromEntries(
  TRAINER_LICENCE_CODES.map((c, i) => [c, i]),
)

/**
 * Parse the stored list into an ordered, de-duplicated array in canonical
 * order. Unknown tokens are dropped — the DB CHECK makes them impossible to
 * store, so anything else here is corrupt data, not a value to render.
 */
export function parseTrainerLicences(value: string | null | undefined): TrainerLicence[] {
  const seen = new Set<TrainerLicence>()
  for (const raw of String(value || '').split(',')) {
    const code = raw.trim().toUpperCase()
    if (code in RANK) seen.add(code as TrainerLicence)
  }
  return [...seen].sort((a, b) => RANK[a] - RANK[b])
}

/** Serialize back to the stored format. Empty selection stores NULL, not ''. */
export function serializeTrainerLicences(codes: readonly string[]): string | null {
  const clean = parseTrainerLicences(codes.join(','))
  return clean.length ? clean.join(',') : null
}

/**
 * i18n key (namespace `auth`) for a code. Labels are deliberately NOT derived
 * from the code — "JS" must render as "J+S", the volleyball rungs read as
 * "Trainer C" and the basketball ones as "Trainer 1", none of which a formatting
 * rule produces from the stored token.
 */
export const TRAINER_LICENCE_I18N_KEYS: Record<TrainerLicence, string> = {
  JS: 'trainerLicenceJS',
  C: 'trainerLicenceC',
  B: 'trainerLicenceB',
  A: 'trainerLicenceA',
  T1: 'trainerLicenceT1',
  T2: 'trainerLicenceT2',
  T3: 'trainerLicenceT3',
}
