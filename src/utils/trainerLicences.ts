// src/utils/trainerLicences.ts
//
// Coaching education (Trainerausbildung) — `members.trainer_licences`,
// migration 274. Stored exactly like `nationalitaet_codes`: an ordered,
// comma-separated code list in a single varchar, parsed on read and
// serialized on write. See src/utils/countries.ts for the same pattern.
//
// The four values are NOT one ladder — J+S (Jugend+Sport Leiter/in) is the
// federal track and C/B/A is the federation trainer ladder, so a member can
// hold several ("JS,B" is an ordinary value).

/** Canonical order — also the order the DB trigger normalizes to. */
export const TRAINER_LICENCE_CODES = ['JS', 'C', 'B', 'A'] as const
export type TrainerLicence = (typeof TRAINER_LICENCE_CODES)[number]

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
 * from the code — "JS" must render as "J+S" and the ladder levels read as
 * "Trainer C", which no formatting rule produces from the stored token.
 */
export const TRAINER_LICENCE_I18N_KEYS: Record<TrainerLicence, string> = {
  JS: 'trainerLicenceJS',
  C: 'trainerLicenceC',
  B: 'trainerLicenceB',
  A: 'trainerLicenceA',
}
