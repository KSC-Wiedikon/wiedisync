import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { saveFile } from '@/utils/saveFile'
import { toast } from 'sonner'
import { exportBaseName, renderAnswer, signupsPdf, signupsXlsx, type SignupsExportInput } from './lib/signupsExport'
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

interface PublicSignup {
  id: number
  name: string
  email: string | null
  phone: string | null
  guest_count: number | null
  note: string | null
  date_created: string | null
}

interface SignupsResponse {
  event: { id: number; title: string; signup_url: string | null }
  internal: InternalSignup[]
  internal_total: number
  public_signups?: PublicSignup[]
  external: {
    title: string
    fields: FormField[]
    data: Record<string, unknown>[]
    total: number
  } | null
  // 'form_not_linked' (audit 2026-09-28 F15): the endpoint reads guest signups
  // only from the form IT created (events.signup_form_slug), never from the
  // client-writable signup_url — a hand-pasted OpnForm link lists nothing.
  external_error: 'form_not_found' | 'upstream_error' | 'form_not_linked' | null
}

interface EventSignupsModalProps {
  open: boolean
  onClose: () => void
  event: Event | null
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
  // A signup_url the endpoint did not bind (hand-pasted link) comes back with
  // external: null and no error — "no form linked", not "no guests yet". Also
  // honours an explicit 'form_not_linked' if the endpoint starts sending one.
  const formNotLinked = !!data && (
    data.external_error === 'form_not_linked'
    || (!!data.event.signup_url && data.external == null && !data.external_error)
  )

  // Excel / PDF with every form reply (lib/signupsExport.ts; English, shared outside the app).
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null)
  function exportAs(kind: 'xlsx' | 'pdf') {
    if (!data || exporting) return
    const input: SignupsExportInput = {
      eventTitle: event?.title ?? data.event.title,
      eventStart: event?.start_date ?? null,
      members: internal,
      formFields: externalFields,
      formRows: externalRows,
      guests: data.public_signups ?? [],
    }
    setExporting(kind)
    ;(kind === 'xlsx' ? signupsXlsx(input) : signupsPdf(input))
      .then((blob) => saveFile(blob, `${exportBaseName(input.eventTitle)}.${kind}`))
      .catch(() => toast.error(t('signupsExportFailed')))
      .finally(() => setExporting(null))
  }

  const total = internal.length + externalRows.length + (data?.public_signups?.length ?? 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('signupsTitle')}
      size="lg"
      disableAutoFocus
      headerAction={total > 0 ? (
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!!exporting} onClick={() => exportAs('xlsx')}>
            {t('signupsExportXlsx')}
          </Button>
          <Button type="button" variant="outline" disabled={!!exporting} onClick={() => exportAs('pdf')}>
            {t('signupsExportPdf')}
          </Button>
        </div>
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
              <h3 className="text-sm font-semibold text-foreground">{t('signupsMembers')}</h3>
              {internal.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('signupsNoMembers')}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-hairline">
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
              <h3 className="text-sm font-semibold text-foreground">{t('signupsGuestsSection')}</h3>
              {data.external_error === 'form_not_found' && (
                <p className="text-sm text-amber-600 dark:text-amber-400">{t('signupsFormMissing')}</p>
              )}
              {data.external_error === 'upstream_error' && (
                <p className="text-sm text-amber-600 dark:text-amber-400">{t('signupsUpstreamError')}</p>
              )}
              {(!data.event.signup_url || formNotLinked) && (
                <p className="text-sm text-muted-foreground">{t('signupsNoForm')}</p>
              )}
              {data.event.signup_url && !formNotLinked && !data.external_error && externalRows.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('signupsNoGuests')}</p>
              )}
              {externalRows.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-hairline">
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
