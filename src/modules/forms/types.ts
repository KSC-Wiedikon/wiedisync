/** Internal Forms feature — shared types (migrations 086/087). */

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'single_choice'
  | 'multi_choice'
  | 'number'
  | 'date'
  | 'yes_no'

export const FIELD_TYPES: FieldType[] = [
  'short_text',
  'long_text',
  'single_choice',
  'multi_choice',
  'number',
  'date',
  'yes_no',
]

/** A single field definition stored in `forms.fields` (JSONB). */
export interface FieldDef {
  id: string
  type: FieldType
  label: string
  required: boolean
  /** Only for single_choice / multi_choice. */
  options?: string[]
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
  opens_at?: string | null
  closes_at?: string | null
  created_by?: string | null
  teams?: FormTeamRef[]
  date_created?: string
  date_updated?: string
}

export type AnswerValue = string | number | boolean | string[] | null

export interface FormSubmission {
  id: string
  form: string
  member?: string | { id: string; first_name?: string; last_name?: string } | null
  answers: Record<string, AnswerValue>
  submitted_at: string
}
