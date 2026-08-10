import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { kscwApi } from '../../lib/api'
import { formatDateTimeCompactZurich } from '../../utils/dateHelpers'
import type { Event } from '../../types'

/** One OpnForm property, as the proxy's `fields` metadata reports it. */
interface FormField {
  id: string
  name: string
  type: string
}

interface InternalSignup {
  id: number
  member_id: number | null
  name: string
  email: string | null
  status: string
  guest_count: number
  date_created: string | null
}

interface SignupsResponse {
  event: { id: number; title: string; signup_url: string | null }
  internal: InternalSignup[]
  internal_total: number
  external: {
    title: string
    fields: FormField[]
    data: Record<string, unknown>[]
    total: number
  } | null
  external_error: 'form_not_found' | 'upstream_error' | null
}

interface EventSignupsModalProps {
  open: boolean
  onClose: () => void
  event: Event | null
}

/** OpnForm answers can be scalars, arrays (multi-select) or objects (files). */
function renderAnswer(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(renderAnswer).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return String(o.name ?? o.file_name ?? o.label ?? JSON.stringify(o))
  }
  return String(v)
}

function csvCell(v: unknown): string {
  const s = renderAnswer(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(filename: string, rows: string[][]): void {
  // Semicolon-separated + BOM: Excel on a Swiss/German locale opens comma CSVs
  // as a single column, and drops the accents without the BOM.
  const body = rows.map((r) => r.join(';')).join('\r\n')
  const blob = new Blob([`\ufeff${body}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * The admin view of "who is actually coming" — both doors in one place.
 *
 * Members and guests are shown as two tables rather than one merged list on
 * purpose: they have genuinely different columns (a member has an RSVP status
 * and a guest count; a guest has whatever the OpnForm asked), and guessing which
 * free-text answer is "the name" in order to merge them would be lossy exactly
 * when the form is non-standard.
 */
export default function EventSignupsModal({ open, onClose, event }: EventSignupsModalProps) {
  const { t } = useTranslation('events')
  const { t: tc } = useTranslation('common')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['event-signups', event?.id],
    queryFn: () => kscwApi<SignupsResponse>(`/events/${event!.id}/signups`),
    enabled: open && !!event,
    // A guest can submit at any moment, so serving a cached list across opens is
    // the failure mode that actually matters here.
    staleTime: 0,
  })

  const internal = data?.internal ?? []
  const externalFields = data?.external?.fields ?? []
  const externalRows = data?.external?.data ?? []

  // Exports are always English regardless of UI locale — they land in ClubDesk
  // and in spreadsheets shared outside the app.
  function exportCsv() {
    const rows: string[][] = [['Source', 'Name', 'Email', 'Status', 'Guests', 'Date']]
    for (const r of internal) {
      rows.push(['Member', csvCell(r.name), csvCell(r.email), csvCell(r.status),
        csvCell(r.guest_count), csvCell(r.date_created)])
    }
    if (externalFields.length > 0) {
      rows.push([])
      rows.push(['Guest signups'])
      rows.push([...externalFields.map((f) => csvCell(f.name)), 'Submitted'])
      for (const r of externalRows) {
        rows.push([
          ...externalFields.map((f) => csvCell(r[f.id])),
          csvCell(r.created_at),
        ])
      }
    }
    const slug = (event?.title ?? 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    downloadCsv(`signups-${slug}.csv`, rows)
  }

  const total = internal.length + externalRows.length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('signupsTitle')}
      size="lg"
      disableAutoFocus
      headerAction={total > 0 ? (
        <Button type="button" variant="outline" className="min-h-[44px]" onClick={exportCsv}>
          {t('signupsExport')}
        </Button>
      ) : undefined}
    >
      <div className="space-y-6">
        {isLoading && <p className="text-sm text-muted-foreground">{tc('loading')}</p>}
        {isError && <p className="text-sm text-red-600 dark:text-red-400">{t('signupsLoadFailed')}</p>}

        {!isLoading && !isError && data && (
          <>
            <p className="text-sm text-muted-foreground">
              {t('signupsSummary', { members: internal.length, guests: externalRows.length })}
            </p>

            {/* Members — the authoritative side; always rendered, even at zero. */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t('signupsMembers')}</h3>
              {internal.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('signupsNoMembers')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('signupsName')}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t('signupsEmail')}</TableHead>
                        <TableHead>{t('signupsStatus')}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t('signupsGuests')}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t('signupsDate')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {internal.map((r) => (
                        <TableRow key={r.id} className="min-h-[44px]">
                          <TableCell className="whitespace-normal break-words">{r.name}</TableCell>
                          <TableCell className="hidden whitespace-normal break-words sm:table-cell">{r.email}</TableCell>
                          <TableCell className="whitespace-normal">{t(`signupsStatus_${r.status}`, r.status)}</TableCell>
                          <TableCell className="hidden sm:table-cell">{r.guest_count || ''}</TableCell>
                          <TableCell className="hidden whitespace-normal sm:table-cell">
                            {r.date_created ? formatDateTimeCompactZurich(r.date_created) : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {/* Guests — only meaningful once a signup form is linked. */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t('signupsGuestsSection')}</h3>
              {data.external_error === 'form_not_found' && (
                <p className="text-sm text-amber-600 dark:text-amber-400">{t('signupsFormMissing')}</p>
              )}
              {data.external_error === 'upstream_error' && (
                <p className="text-sm text-amber-600 dark:text-amber-400">{t('signupsUpstreamError')}</p>
              )}
              {!data.event.signup_url && (
                <p className="text-sm text-muted-foreground">{t('signupsNoForm')}</p>
              )}
              {data.event.signup_url && !data.external_error && externalRows.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('signupsNoGuests')}</p>
              )}
              {externalRows.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {externalFields.map((f) => (
                          <TableHead key={f.id}>{f.name}</TableHead>
                        ))}
                        <TableHead className="hidden sm:table-cell">{t('signupsDate')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {externalRows.map((r, i) => (
                        <TableRow key={String(r.id ?? i)} className="min-h-[44px]">
                          {externalFields.map((f) => (
                            <TableCell key={f.id} className="whitespace-normal break-words">
                              {renderAnswer(r[f.id])}
                            </TableCell>
                          ))}
                          <TableCell className="hidden whitespace-normal sm:table-cell">
                            {r.created_at ? formatDateTimeCompactZurich(String(r.created_at)) : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  )
}
