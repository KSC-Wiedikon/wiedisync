// Typed contract for member-values.js (frontend alias `@member-values`).
export type Salutation = 'mr' | 'ms'
export const SALUTATION_VALUES: Salutation[]
export function normalizeSalutation(v: unknown): Salutation | null
export function salutationToClubdesk(v: unknown): string
export function salutationForSex(sex: unknown): Salutation | null

export const CANTONAL_SCHOOL_NONE: 'none'
export const CANTONAL_SCHOOL_OTHER: 'other'
export function normalizeCantonalSchool(v: unknown): string | null
export function cantonalSchoolToLegacy(v: unknown): string

export const LICENCE_CATEGORY_OFFICIAL: 'official'
export function normalizeLicenceCategory(v: unknown): string | null
export function licenceCategoryToClubdesk(v: unknown): string
