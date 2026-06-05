/** Internal Forms feature — shared types (migrations 086/087). */

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'url'
  | 'number'
  | 'single_choice'
  | 'multi_choice'
  | 'yes_no'
  | 'date'
  | 'time'
  | 'datetime'
  | 'rating'
  | 'file'

export const FIELD_TYPES: FieldType[] = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  'single_choice',
  'multi_choice',
  'yes_no',
  'date',
  'time',
  'datetime',
  'rating',
  'file',
]

/** Locales the form builder can author per-field labels in. */
export type FormLocale = 'de' | 'en' | 'fr' | 'gsw' | 'it'

/** A single field definition stored in `forms.fields` (JSONB). */
export interface FieldDef {
  id: string
  type: FieldType
  label: string
  required: boolean
  /** Only for single_choice / multi_choice. */
  options?: string[]
  /**
   * Optional per-locale label overrides. When the active UI locale has an
   * entry the renderer uses it; otherwise it falls back to `label`. Lets a
   * club-wide form read natively in all five languages.
   */
  label_i18n?: Partial<Record<FormLocale, string>>
}

export type FormStatus = 'draft' | 'open' | 'closed'
export type FormAudience = 'club_wide' | 'teams'

/** Junction-expanded team ref, or a bare id depending on the query. */
export type FormTeamRef = { teams_id: string | number | { id: string | number } } | string | number

export interface FormDef {
  id: string
  title: string
  description?: string | null
  status: FormStatus
  audience: FormAudience
  fields: FieldDef[]
  anonymous: boolean
  allow_multiple: boolean
  /** Optional custom thank-you text shown after submit (migration 088). */
  success_message?: string | null
  /** Public/external form, served on the website (migration 089). */
  is_public?: boolean
  /** URL-safe public identifier (unique) — required when is_public. */
  slug?: string | null
  opens_at?: string | null
  closes_at?: string | null
  created_by?: string | null
  teams?: FormTeamRef[]
  date_created?: string
  date_updated?: string
}

/** An uploaded file answer: Directus file id + original display name. */
export interface FileAnswer { id: string; name: string }

export type AnswerValue = string | number | boolean | string[] | FileAnswer | null

export interface FormSubmission {
  id: string
  form: string
  member?: string | { id: string; first_name?: string; last_name?: string } | null
  answers: Record<string, AnswerValue>
  submitted_at: string
}
