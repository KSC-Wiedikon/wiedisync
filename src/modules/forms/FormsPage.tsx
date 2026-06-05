import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Pencil, BarChart3, Trash2, Lock, Unlock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useCollection } from '../../lib/query'
import { updateRecord, deleteRecord } from '../../lib/api'
import { formatDateTimeCompactZurich } from '../../utils/dateHelpers'
import FormBuilder from './FormBuilder'
import FormFillModal from './FormFillModal'
import FormResponsesModal from './FormResponsesModal'
import type { FormDef, FormStatus } from './types'

interface SubmissionRef { id: string; form: string }

function teamRefs(form: FormDef): { id: string; name: string }[] {
  return (form.teams ?? []).map((tref) => {
    if (typeof tref === 'object' && tref !== null && 'teams_id' in tref) {
      const tid = (tref as { teams_id: unknown }).teams_id
      if (typeof tid === 'object' && tid !== null) {
        const o = tid as { id: string | number; name?: string }
        return { id: String(o.id), name: o.name ?? String(o.id) }
      }
      return { id: String(tid), name: String(tid) }
    }
    return { id: String(tref), name: String(tref) }
  })
}

function StatusBadge({ status }: { status: FormStatus }) {
  const { t } = useTranslation('forms')
  const cls =
    status === 'open'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
      : status === 'closed'
        ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{t(`status${status[0].toUpperCase()}${status.slice(1)}`)}</span>
}

export default function FormsPage() {
  const { t } = useTranslation('forms')
  const { t: tc } = useTranslation('common')
  const { user, coachTeamIds, memberTeamIds } = useAuth()
  const { effectiveIsAdmin } = useAdminMode()
  const canAuthor = effectiveIsAdmin || coachTeamIds.length > 0

  const { data: formsRaw, isLoading, refetch } = useCollection<FormDef>('forms', {
    fields: ['*', 'teams.teams_id.id', 'teams.teams_id.name'],
    sort: ['-date_created'],
    limit: 200,
  })
  const forms = formsRaw ?? []

  const { data: mySubsRaw } = useCollection<SubmissionRef>('form_submissions', {
    filter: { member: { _eq: user?.id } },
    fields: ['id', 'form'],
    limit: 1000,
    enabled: !!user,
  })
  const submittedFormIds = useMemo(() => new Set((mySubsRaw ?? []).map((s) => String(s.form))), [mySubsRaw])

  const editable = (f: FormDef): boolean =>
    effectiveIsAdmin ||
    String(f.created_by ?? '') === String(user?.id ?? '') ||
    teamRefs(f).some((tr) => coachTeamIds.includes(tr.id))

  const managedForms = useMemo(() => (canAuthor ? forms.filter(editable) : []), [forms, canAuthor]) // eslint-disable-line react-hooks/exhaustive-deps

  const openForms = useMemo(
    () =>
      forms.filter(
        (f) =>
          f.status === 'open' &&
          (f.audience === 'club_wide' || teamRefs(f).some((tr) => memberTeamIds.includes(tr.id))),
      ),
    [forms, memberTeamIds],
  )

  const [builderOpen, setBuilderOpen] = useState(false)
  const [editForm, setEditForm] = useState<FormDef | null>(null)
  const [fillForm, setFillForm] = useState<FormDef | null>(null)
  const [responsesForm, setResponsesForm] = useState<FormDef | null>(null)

  async function toggleStatus(f: FormDef) {
    const next: FormStatus = f.status === 'open' ? 'closed' : 'open'
    await updateRecord('forms', f.id, { status: next })
    refetch()
  }
  async function remove(f: FormDef) {
    if (!window.confirm(t('confirmDelete', { title: f.title }))) return
    await deleteRecord('forms', f.id)
    refetch()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        {canAuthor && (
          <Button onClick={() => { setEditForm(null); setBuilderOpen(true) }}>
            <Plus size={16} className="mr-1" /> {t('newForm')}
          </Button>
        )}
      </div>

      {/* Open for you */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('openForYou')}</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : openForms.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noOpenForms')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('formTitle')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('closesAt')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openForms.map((f) => {
                const done = !f.anonymous && !f.allow_multiple && submittedFormIds.has(String(f.id))
                return (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.title}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {f.closes_at ? formatDateTimeCompactZurich(f.closes_at) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {done ? (
                        <span className="text-sm text-green-600 dark:text-green-400">{t('submitted')}</span>
                      ) : (
                        <Button size="sm" onClick={() => setFillForm(f)}>{t('fill')}</Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {/* Manage */}
      {canAuthor && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('manageForms')}</h2>
          {managedForms.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noManagedForms')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('formTitle')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('audience')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managedForms.map((f) => {
                  const teams = teamRefs(f)
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.title}</TableCell>
                      <TableCell><StatusBadge status={f.status} /></TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {f.audience === 'club_wide' ? t('audienceClub') : teams.map((tr) => tr.name).join(', ') || t('audienceTeams')}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col justify-end gap-1 sm:flex-row">
                          <Button variant="ghost" size="sm" onClick={() => setResponsesForm(f)} title={t('responses')}><BarChart3 size={15} /></Button>
                          <Button variant="ghost" size="sm" onClick={() => { setEditForm(f); setBuilderOpen(true) }} title={tc('edit')}><Pencil size={15} /></Button>
                          <Button variant="ghost" size="sm" onClick={() => toggleStatus(f)} title={f.status === 'open' ? t('close') : t('open')}>
                            {f.status === 'open' ? <Lock size={15} /> : <Unlock size={15} />}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => remove(f)} title={tc('delete')} className="text-red-500"><Trash2 size={15} /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {builderOpen && (
        <FormBuilder
          open={builderOpen}
          form={editForm}
          onSave={() => { setBuilderOpen(false); setEditForm(null); refetch() }}
          onCancel={() => { setBuilderOpen(false); setEditForm(null) }}
        />
      )}
      {fillForm && (
        <FormFillModal
          open={!!fillForm}
          form={fillForm}
          onSubmitted={() => { setFillForm(null); refetch() }}
          onCancel={() => setFillForm(null)}
        />
      )}
      {responsesForm && (
        <FormResponsesModal open={!!responsesForm} form={responsesForm} onClose={() => setResponsesForm(null)} />
      )}
    </div>
  )
}
