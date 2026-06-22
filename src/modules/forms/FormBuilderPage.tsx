import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../lib/query'
import { useReportPageLoading } from '../../hooks/usePageReady'
import FormBuilder from './FormBuilder'
import type { FormDef } from './types'

/**
 * Full-page host for the form builder (create + edit), replacing the old modal —
 * the builder grew too large for a dialog. Route: /forms/new and
 * /forms/:formId/edit. Author-gated (mirrors FormsPage); members never reach it.
 */
export default function FormBuilderPage() {
  const { t } = useTranslation('forms')
  const navigate = useNavigate()
  const { formId } = useParams()
  const isEdit = !!formId

  const { isAdmin, isVorstand, coachTeamIds, teamResponsibleIds } = useAuth()
  const canManageForms =
    isAdmin || isVorstand || coachTeamIds.length > 0 || teamResponsibleIds.length > 0

  const { data: formsRaw, isLoading } = useCollection<FormDef>('forms', {
    filter: { id: { _eq: formId } },
    fields: ['*', 'teams.teams_id.id', 'teams.teams_id.name', 'teams.teams_id.sport'],
    limit: 1,
    enabled: isEdit && canManageForms,
  })
  const form = useMemo(() => (isEdit ? (formsRaw ?? [])[0] ?? null : null), [formsRaw, isEdit])

  // Report to the app boot gate — see usePageReady.tsx. Only edit mode loads a
  // form; "new" mode is a blank editor, so nothing to wait on there.
  useReportPageLoading(isEdit && isLoading)

  if (!canManageForms) return <Navigate to="/forms" replace />

  const back = () => navigate('/forms')

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <button
        onClick={back}
        className="mb-4 inline-flex min-h-[36px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} /> {t('title')}
      </button>
      <h1 className="mb-6 text-2xl font-bold">{isEdit ? t('editForm') : t('newForm')}</h1>

      {isEdit && isLoading ? (
        null
      ) : isEdit && !form ? (
        <p className="text-sm text-muted-foreground">{t('noManagedForms')}</p>
      ) : (
        <FormBuilder form={form} onSave={back} onCancel={back} />
      )}
    </div>
  )
}
