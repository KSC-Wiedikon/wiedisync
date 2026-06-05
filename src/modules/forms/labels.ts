import type { FieldDef, FormLocale } from './types'

export const FORM_LOCALES: FormLocale[] = ['de', 'en', 'fr', 'gsw', 'it']

/** Normalise an i18next language code (e.g. `de-CH`, `gsw`) to a FormLocale. */
export function toFormLocale(lang: string | undefined): FormLocale {
  const l = (lang || 'en').toLowerCase()
  if (l.startsWith('gsw')) return 'gsw'
  if (l.startsWith('de')) return 'de'
  if (l.startsWith('fr')) return 'fr'
  if (l.startsWith('it')) return 'it'
  return 'en'
}

/**
 * Resolve a field's label for the active UI locale: a `label_i18n` override
 * wins, then the base `label`, then any non-empty translation, then ''.
 */
export function resolveFieldLabel(field: FieldDef, lang: string | undefined): string {
  const loc = toFormLocale(lang)
  const override = field.label_i18n?.[loc]?.trim()
  if (override) return override
  if (field.label?.trim()) return field.label
  for (const code of FORM_LOCALES) {
    const v = field.label_i18n?.[code]?.trim()
    if (v) return v
  }
  return ''
}
