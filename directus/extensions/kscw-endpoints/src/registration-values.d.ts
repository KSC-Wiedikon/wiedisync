// Typed contract for registration-values.js (imported by the frontend through
// the `@registration-values` alias). Keep in step with the module next door.

export const REG_KEY_RENAMES: Record<string, string>

export type RegSex = 'm' | 'f'
export const SEX_VALUES: RegSex[]
export function normalizeSex(v: unknown): RegSex | null
export function sexToClubdesk(v: unknown): string
export function salutationFromSex(v: unknown): string

export type RegRole = 'player' | 'coach' | 'guest' | 'team_responsible' | 'other'
export const ROLE_VALUES: RegRole[]
export function normalizeRole(v: unknown): RegRole | null
export function roleToClubdesk(v: unknown): string

export type RegOfficial = 'vb_scorer' | 'vb_referee' | 'bb_referee' | 'otr1' | 'otr2' | 'otn'
export const OFFICIAL_VALUES: RegOfficial[]
export function officialSlug(token: unknown, membershipType?: string | null): RegOfficial | null
export function normalizeOfficials(v: unknown, membershipType?: string | null): string | null
export function officialsList(v: unknown): RegOfficial[]
export function officialsToClubdesk(v: unknown, membershipType?: string | null): string

export type BbSituation = 'new' | 'transfer_ch' | 'transfer_intl' | 'returning'
export const BB_SITUATION_VALUES: BbSituation[]
export function normalizeBbSituation(v: unknown): BbSituation | null
export function normalizeRecentLicence(v: unknown): boolean | null

export function englishRegistrationBody(body: unknown): Record<string, unknown>
