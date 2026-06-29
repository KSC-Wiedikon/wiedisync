import { Fragment, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X, ChevronDown, ChevronUp, Save, Download, FileText, ExternalLink, ArrowUpFromLine } from 'lucide-react'
import { useCollection, useUpdate } from '../../lib/query'
import { useAuth } from '../../hooks/useAuth'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { assetUrl } from '../../lib/api'
import { sanitizeUrl } from '../../utils/sanitizeUrl'
import TeamChip from '../../components/TeamChip'
import ClubdeskMemberSyncButton from './components/ClubdeskMemberSyncButton'
import ClubdeskSyncUpModal from './components/ClubdeskSyncUpModal'
import { Button } from '../../components/ui/button'
import { formatDate } from '../../utils/dateHelpers'
import { localizeCountry } from '../../utils/countryName'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog'
import type { BaseRecord, Team } from '../../types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'

interface Registration extends BaseRecord {
  status: 'pending' | 'approved' | 'rejected'
  membership_type: 'volleyball' | 'basketball' | 'passive'
  vorname: string
  nachname: string
  email: string
  telefon_mobil: string | null
  adresse: string | null
  plz: string | null
  ort: string | null
  geburtsdatum: string | null
  nationalitaet: string | null
  nationalitaet_code: string | null
  geschlecht: string | null
  team: string | null
  beitragskategorie: string | null
  bemerkungen: string | null
  reference_number: string
  submitted_at: string
  rolle: string | null
  lizenz: string | null
  schiedsrichter_stufe: string | null
  ahv_nummer: string | null
  kantonsschule: string | null
  locale: string | null
  rejection_reason: string | null
  bb_doc_lizenz: string | null
  bb_doc_selfdecl: string | null
  bb_doc_natdecl: string | null
  id_upload_front: string | null
  id_upload_back: string | null
}

// All document fields a registration can carry (BB docs + ID front/back)
const DOC_FIELDS: (keyof Registration)[] = [
  'bb_doc_lizenz',
  'bb_doc_selfdecl',
  'bb_doc_natdecl',
  'id_upload_front',
  'id_upload_back',
]
const countDocs = (reg: Registration): number => DOC_FIELDS.filter((k) => reg[k]).length


type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

// ── CSV export (ClubDesk format) ───────────────────────────────
function csvEscape(val: string): string {
  const s = String(val ?? '')
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function buildClubDeskCSV(items: Registration[]): string {
  const headers = [
    'Nachname', 'Vorname', 'Firma', 'Adresse', 'PLZ', 'Ort',
    'Telefon Privat', 'Telefon Mobil', '[Gruppen]', 'Sektion', 'Gruppe', 'Gruppen',
    'Anrede', 'Titel', 'Briefanrede', 'Benutzer-Id', 'Adress-Zusatz', 'Land',
    'Nationalität', 'Telefon Geschäft', 'Fax', 'E-Mail', 'E-Mail Alternativ',
    'Status', '[Rolle]', 'Eintritt', 'Mitgliedsjahre', 'Austritt', 'Zivilstand',
    'Geschlecht', 'Geburtsdatum', 'Jahrgang', 'Alter', 'Bemerkungen',
    'Firmen-Webseite', 'Rechnungsversand', 'Nie mahnen', 'IBAN', 'BIC', 'Kontoinhaber',
    'Lizenznummer', 'Lizenzart', 'Lizenz bestellt', 'Beitragskategorie',
    'Betrag Bezahlt', 'Clubnummer', 'Mittelschule ZH', 'Offiziellen Lizenz',
    'Mitgliederbeitrag', 'AHV Nummer', 'Passivmitglied', 'Offiziellen 100er',
    'Funktion', 'Rolle',
  ]

  const rows = items.map((item) => {
    let dob = ''
    let jahrgang = ''
    if (item.geburtsdatum) {
      const parts = String(item.geburtsdatum).substring(0, 10).split('-')
      dob = parts[2] + '.' + parts[1] + '.' + parts[0]
      jahrgang = parts[0]
    }
    const now = new Date()
    const todayStr = String(now.getDate()).padStart(2, '0') + '.' +
      String(now.getMonth() + 1).padStart(2, '0') + '.' + now.getFullYear()

    const sektion = item.membership_type === 'volleyball' ? 'Volleyball'
      : item.membership_type === 'basketball' ? 'Basketball' : 'KSCW'
    const status = item.membership_type === 'passive' ? 'Passivmitglied' : 'Aktivmitglied'
    const isPassive = item.membership_type === 'passive' ? 'ja' : ''

    return [
      item.nachname || '', item.vorname || '', '',
      item.adresse || '', item.plz || '', item.ort || '',
      '', item.telefon_mobil || '',
      item.team || '', sektion, '', '',
      '', '', '', '', '', 'Schweiz',
      item.nationalitaet || '', '', '',
      item.email || '', '',
      status, '', todayStr, '', '', '',
      item.geschlecht || '', dob, jahrgang, '',
      item.bemerkungen || '',
      '', 'E-Mail', 'Nein', '', '', '',
      '', '', '',
      item.beitragskategorie || '',
      '', '',
      item.kantonsschule || '',
      item.lizenz || '',
      '',
      item.ahv_nummer || '',
      isPassive, '',
      item.rolle || '', '',
    ].map(csvEscape)
  })

  return '\uFEFF' + headers.join(';') + '\n' + rows.map(r => r.join(';')).join('\n')
}

function downloadCSV(items: Registration[]) {
  const csv = buildClubDeskCSV(items)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `anmeldungen_clubdesk_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Sport section colors ───────────────────────────────────────
const SPORT_STYLES = {
  volleyball: { accent: 'border-l-yellow-400', icon: '🏐', label: 'Volleyball' },
  basketball: { accent: 'border-l-orange-400', icon: '🏀', label: 'Basketball' },
  passive: { accent: 'border-l-gray-400', icon: '👤', label: 'Passiv' },
} as const

export default function AnmeldungenPage() {
  const { t } = useTranslation('admin')
  const { isGlobalAdmin, isVbAdmin, isBbAdmin } = useAuth()
  const [syncUpOpen, setSyncUpOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [rejectTarget, setRejectTarget] = useState<Registration | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [previewFile, setPreviewFile] = useState<{ url: string; label: string } | null>(null)

  const allowedSports = useMemo(() => {
    if (isGlobalAdmin) return ['volleyball', 'basketball', 'passive'] as const
    const sports: ('volleyball' | 'basketball' | 'passive')[] = []
    if (isVbAdmin) sports.push('volleyball')
    if (isBbAdmin) sports.push('basketball')
    return sports
  }, [isGlobalAdmin, isVbAdmin, isBbAdmin])

  // Fetch all registrations for allowed sports + status filter
  const filter = useMemo((): Record<string, unknown> => {
    const conditions: Record<string, unknown>[] = []
    if (statusFilter !== 'all') {
      conditions.push({ status: { _eq: statusFilter } })
    }
    if (!isGlobalAdmin) {
      conditions.push({ membership_type: { _in: allowedSports } })
    }
    if (conditions.length === 0) return {}
    return conditions.length === 1 ? conditions[0] : { _and: conditions }
  }, [statusFilter, isGlobalAdmin, allowedSports])

  const { data: registrationsRaw, isLoading } = useCollection<Registration>('registrations', {
    filter,
    sort: ['-submitted_at'],
    all: true,
  })
  const registrations = registrationsRaw ?? []

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  // Group by sport
  const grouped = useMemo(() => {
    const map: Record<string, Registration[]> = { volleyball: [], basketball: [], passive: [] }
    for (const reg of registrations) {
      (map[reg.membership_type] ??= []).push(reg)
    }
    return map
  }, [registrations])

  const { data: teamsRaw } = useCollection<Team & BaseRecord>('teams', {
    filter: { active: { _eq: true } },
    sort: ['name'],
    all: true,
  })
  const teams = teamsRaw ?? []
  const teamByName = useMemo(() => {
    const map: Record<string, Team & BaseRecord> = {}
    teams.forEach((t) => { map[t.name] = t })
    return map
  }, [teams])

  const { mutate: updateReg, isPending: isUpdating } = useUpdate<Registration>('registrations', {
    onError: () => toast.error(t('anmeldungenUpdateError')),
  })

  const handleApprove = (reg: Registration) => {
    updateReg({ id: reg.id, data: { status: 'approved' } }, {
      onSuccess: () => toast.success(t('anmeldungenApprovedToast')),
    })
  }

  const openRejectModal = (reg: Registration) => {
    setRejectTarget(reg)
    setRejectReason('')
  }

  const confirmReject = () => {
    if (!rejectTarget || !rejectReason.trim()) return
    updateReg({ id: rejectTarget.id, data: { status: 'rejected', rejection_reason: rejectReason.trim() } }, {
      onSuccess: () => toast.success(t('anmeldungenRejectedToast')),
    })
    setRejectTarget(null)
    setRejectReason('')
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === registrations.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(registrations.map(r => r.id)))
    }
  }, [selectedIds.size, registrations])

  const selectedRegistrations = useMemo(
    () => registrations.filter(r => selectedIds.has(r.id)),
    [registrations, selectedIds],
  )

  const statusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{t('anmeldungenPending')}</span>
      case 'approved':
        return <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">{t('anmeldungenApproved')}</span>
      case 'rejected':
        return <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">{t('anmeldungenRejected')}</span>
      default:
        return null
    }
  }

  // Sections to render — only those the admin has access to
  const sections = allowedSports.filter(sport => grouped[sport]?.length > 0 || isGlobalAdmin)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('anmeldungenTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('anmeldungenDescription')}</p>
        </div>
        {isGlobalAdmin && (
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <ClubdeskMemberSyncButton />
            <Button type="button" variant="outline" size="sm" onClick={() => setSyncUpOpen(true)} className="gap-2">
              <ArrowUpFromLine className="h-4 w-4" />{t('clubdeskUpButton')}
            </Button>
          </div>
        )}
      </div>
      {isGlobalAdmin && <ClubdeskSyncUpModal open={syncUpOpen} onOpenChange={setSyncUpOpen} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="all">{t('anmeldungenAllStatuses')}</option>
          <option value="pending">{t('anmeldungenPending')}</option>
          <option value="approved">{t('anmeldungenApproved')}</option>
          <option value="rejected">{t('anmeldungenRejected')}</option>
        </select>

        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
          {registrations.length} {t('anmeldungenCount')}
        </span>
      </div>

      {/* Multi-select toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-950">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
            {selectedIds.size} {t('anmeldungenSelected')}
          </span>
          <button
            onClick={() => downloadCSV(selectedRegistrations)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Download className="h-3.5 w-3.5" />
            {t('anmeldungenDownloadCSV')}
          </button>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">…</div>
      ) : registrations.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">{t('anmeldungenNoRecords')}</div>
      ) : (
        <div className="space-y-8">
          {/* Select all */}
          <div className="flex items-center gap-2 px-4">
            <input
              type="checkbox"
              checked={selectedIds.size === registrations.length && registrations.length > 0}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 dark:border-gray-600"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('anmeldungenSelectAll')}</span>
          </div>

          {sections.map((sport) => {
            const items = grouped[sport] ?? []
            if (items.length === 0) return null
            const style = SPORT_STYLES[sport]

            return (
              <div key={sport} className={`border-l-4 ${style.accent} pl-0`}>
                {/* Section header */}
                <div className="mb-3 flex items-center gap-2 pl-4">
                  <span className="text-lg">{style.icon}</span>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {sport === 'passive' ? t('anmeldungenPassive') : style.label}
                  </h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {items.length}
                  </span>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead className="text-gray-500 dark:text-gray-400">{t('anmeldungenColName')}</TableHead>
                        <TableHead className="hidden sm:table-cell text-gray-500 dark:text-gray-400">{t('anmeldungenColStatus')}</TableHead>
                        <TableHead className="hidden md:table-cell text-gray-500 dark:text-gray-400">{t('anmeldungenColTeam')}</TableHead>
                        <TableHead className="hidden lg:table-cell text-gray-500 dark:text-gray-400">{t('anmeldungenColSubmitted')}</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((reg) => {
                        const isExpanded = expandedId === reg.id
                        return (
                          <Fragment key={reg.id}>
                            <TableRow className="align-top">
                              <TableCell>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(reg.id)}
                                  onChange={() => toggleSelect(reg.id)}
                                  className="h-4 w-4 rounded border-gray-300 text-blue-600 dark:border-gray-600"
                                />
                              </TableCell>
                              <TableCell className="whitespace-normal">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span className="block sm:inline font-medium text-gray-900 dark:text-gray-100">{reg.nachname}</span>
                                  <span className="block sm:inline text-gray-600 dark:text-gray-400 sm:text-gray-900 sm:dark:text-gray-100">{reg.vorname}</span>
                                  <span className="sm:hidden">{statusBadge(reg.status)}</span>
                                </div>
                                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 break-all">{reg.email}</div>
                                <div className="md:hidden mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                  {reg.team && reg.team.split(',').map((tm) => {
                                    const name = tm.trim()
                                    const tObj = teamByName[name]
                                    return tObj ? (
                                      <TeamChip key={name} team={tObj.name} size="xs" />
                                    ) : (
                                      <span key={name}>{name}</span>
                                    )
                                  })}
                                  {countDocs(reg) > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-400">
                                      <FileText className="h-3 w-3" />
                                      {countDocs(reg)} docs
                                    </span>
                                  )}
                                </div>
                                <div className="lg:hidden mt-0.5 text-[11px] text-gray-400">{formatDate(reg.submitted_at)}</div>
                              </TableCell>
                              <TableCell className="hidden sm:table-cell">{statusBadge(reg.status)}</TableCell>
                              <TableCell className="hidden md:table-cell">
                                <div className="flex flex-wrap items-center gap-1">
                                  {reg.team && reg.team.split(',').map((tm) => {
                                    const name = tm.trim()
                                    const tObj = teamByName[name]
                                    return tObj ? (
                                      <TeamChip key={name} team={tObj.name} size="xs" />
                                    ) : (
                                      <span key={name} className="text-xs">{name}</span>
                                    )
                                  })}
                                  {countDocs(reg) > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-xs text-orange-600 dark:text-orange-400">
                                      <FileText className="h-3 w-3" />
                                      {countDocs(reg)}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(reg.submitted_at)}</TableCell>
                              <TableCell className="text-right">
                                <button
                                  onClick={() => setExpandedId(isExpanded ? null : reg.id)}
                                  className="rounded-md p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                  title={t('anmeldungenDetails')}
                                >
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-gray-50/50 dark:bg-gray-900/30 hover:bg-gray-50/50 dark:hover:bg-gray-900/30">
                                <TableCell colSpan={6} className="whitespace-normal p-0">
                                  <ExpandedDetails
                                    reg={reg}
                                    t={t}
                                    onSave={(data) => updateReg({ id: reg.id, data }, { onSuccess: () => toast.success(t('anmeldungenUpdated')) })}
                                    onApprove={() => handleApprove(reg)}
                                    onReject={() => openRejectModal(reg)}
                                    onPreviewFile={setPreviewFile}
                                    isUpdating={isUpdating}
                                  />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Reject modal */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('anmeldungenRejectTitle')}</DialogTitle>
            <DialogDescription>
              {rejectTarget && `${rejectTarget.vorname} ${rejectTarget.nachname} — ${rejectTarget.membership_type}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('anmeldungenRejectReasonLabel')} *
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:text-gray-100"
              placeholder={t('anmeldungenRejectReasonPlaceholder')}
              autoFocus
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setRejectTarget(null)}
              className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t('cancel')}
            </button>
            <button
              onClick={confirmReject}
              disabled={!rejectReason.trim() || isUpdating}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
            >
              {t('anmeldungenConfirmReject')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File preview modal */}
      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) setPreviewFile(null) }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{previewFile?.label}</DialogTitle>
          </DialogHeader>
          {previewFile && <FilePreview url={previewFile.url} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── File preview component ─────────────────────────────────────
function FilePreview({ url }: { url: string }) {
  // Try to render as image — if it fails (PDF/other), show a download prompt
  const [isImage, setIsImage] = useState(true)
  // 2026-05-12 audit #17: defence-in-depth — `url` is produced by assetUrl()
  // which builds from API_URL + fileId. UUID format constraint makes
  // injection unlikely; routing through sanitizeUrl makes the pattern
  // consistent with sponsor / pr_url sinks elsewhere.
  const safeUrl = sanitizeUrl(url)
  if (!safeUrl) return null

  return (
    <div className="flex flex-col items-center gap-3">
      {isImage ? (
        <img
          src={safeUrl}
          alt="Document"
          className="max-h-[70vh] w-auto rounded-md border border-gray-200 dark:border-gray-700"
          onError={() => setIsImage(false)}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-gray-500 dark:text-gray-400">
          <FileText className="h-12 w-12" />
          <p className="text-sm">PDF — im neuen Tab öffnen</p>
        </div>
      )}
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        In neuem Tab öffnen
      </a>
    </div>
  )
}

// ── Expanded details ───────────────────────────────────────────
function ExpandedDetails({
  reg,
  t,
  onSave,
  onApprove,
  onReject,
  onPreviewFile,
  isUpdating,
}: {
  reg: Registration
  t: (key: string) => string
  onSave: (data: Partial<Registration>) => void
  onApprove: () => void
  onReject: () => void
  onPreviewFile: (file: { url: string; label: string }) => void
  isUpdating: boolean
}) {
  const [edits, setEdits] = useState<Record<string, string>>({})
  const hasChanges = Object.keys(edits).length > 0

  // The form stores gender as the German canonical value (männlich/weiblich)
  // regardless of the submitter's language — show it in the viewer's locale.
  // Reuses the shared dhSetMale/dhSetFemale labels (same admin namespace).
  const localizeGender = (v: string): string => {
    const g = v.trim().toLowerCase()
    if (['männlich', 'male', 'm', 'mann', 'man'].includes(g)) return t('dhSetMale')
    if (['weiblich', 'female', 'f', 'frau', 'woman'].includes(g)) return t('dhSetFemale')
    return v
  }

  const field = (key: keyof Registration, label: string, opts?: { type?: string; full?: boolean; display?: (v: string) => string }) => {
    const raw = (reg[key] as string) ?? ''
    const original = opts?.display ? opts.display(raw) : raw
    const value = edits[key] ?? original
    return (
      <div className={opts?.full ? 'sm:col-span-2' : ''}>
        <label className="mb-0.5 block text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
        <input
          type={opts?.type ?? 'text'}
          value={value}
          onChange={(e) => {
            const v = e.target.value
            if (v === original) {
              const next = { ...edits }
              delete next[key]
              setEdits(next)
            } else {
              setEdits({ ...edits, [key]: v })
            }
          }}
          className="w-full rounded-md border border-gray-200 bg-transparent px-2.5 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:text-gray-100"
        />
      </div>
    )
  }

  const handleSave = () => {
    if (!hasChanges) return
    onSave(edits as Partial<Registration>)
    setEdits({})
  }

  const bbDocs: { key: keyof Registration; label: string }[] = [
    { key: 'bb_doc_lizenz', label: t('anmeldungenDocLizenz') },
    { key: 'bb_doc_selfdecl', label: t('anmeldungenDocSelfDecl') },
    { key: 'bb_doc_natdecl', label: t('anmeldungenDocNatDecl') },
  ]
  const idDocs: { key: keyof Registration; label: string }[] = [
    { key: 'id_upload_front', label: t('anmeldungenDocIdFront') },
    { key: 'id_upload_back', label: t('anmeldungenDocIdBack') },
  ]

  const renderDoc = ({ key, label }: { key: keyof Registration; label: string }) => {
    const fileId = reg[key] as string | null
    if (!fileId) {
      return (
        <div
          key={key}
          className="flex items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-400 dark:border-gray-600"
        >
          <FileText className="h-4 w-4" />
          <span>{label}</span>
          <span className="ml-auto text-xs">—</span>
        </div>
      )
    }
    const url = assetUrl(fileId)
    return (
      <button
        key={key}
        onClick={() => onPreviewFile({ url, label })}
        className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300 dark:hover:bg-orange-900"
      >
        <FileText className="h-4 w-4" />
        <span className="truncate">{label}</span>
        <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0" />
      </button>
    )
  }

  return (
    <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
      <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
        {field('vorname', t('anmeldungenFirstName'))}
        {field('nachname', t('anmeldungenLastName'))}
        {field('email', t('anmeldungenEmail'), { type: 'email' })}
        {field('telefon_mobil', t('anmeldungenPhone'))}
        {field('adresse', t('anmeldungenAddress'), { full: true })}
        {field('plz', 'PLZ')}
        {field('ort', t('anmeldungenCity'))}
        {field('geburtsdatum', t('anmeldungenDob'), { type: 'date' })}
        {field('nationalitaet', t('anmeldungenNationality'), { display: (v) => localizeCountry(reg.nationalitaet_code, v) })}
        {field('geschlecht', t('anmeldungenGender'), { display: localizeGender })}
        {field('rolle', t('anmeldungenFunction'))}
        {field('team', t('anmeldungenTeam'))}
        {field('beitragskategorie', t('anmeldungenFeeCategory'))}
        {field('lizenz', t('anmeldungenLicence'))}
        {field('schiedsrichter_stufe', t('anmeldungenRefLevel'))}
        {field('kantonsschule', t('anmeldungenSchool'))}
        {field('ahv_nummer', 'AHV')}
        {field('bemerkungen', t('anmeldungenNotes'), { full: true })}
        <div>
          <label className="mb-0.5 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('anmeldungenRef')}</label>
          <div className="px-2.5 py-1.5 text-sm text-gray-500 dark:text-gray-400">{reg.reference_number}</div>
        </div>
      </div>

      {/* BB document previews */}
      {reg.membership_type === 'basketball' && (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('anmeldungenDocuments')}
          </h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {bbDocs.map(renderDoc)}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {idDocs.map(renderDoc)}
          </div>
        </div>
      )}

      {/* Rejection reason display */}
      {reg.status === 'rejected' && reg.rejection_reason && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-950">
          <div className="text-xs font-medium text-red-700 dark:text-red-300">{t('anmeldungenRejectionReason')}</div>
          <div className="mt-0.5 text-sm text-red-600 dark:text-red-400">{reg.rejection_reason}</div>
        </div>
      )}

      {/* Action bar: save first if edited, then approve/reject */}
      <div className="mt-3 flex items-center justify-end gap-2">
        {hasChanges ? (
          <button
            onClick={handleSave}
            disabled={isUpdating}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {t('save')}
          </button>
        ) : reg.status === 'pending' ? (
          <>
            <button
              onClick={onApprove}
              disabled={isUpdating}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              {t('anmeldungenApprove')}
            </button>
            <button
              onClick={onReject}
              disabled={isUpdating}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
              {t('anmeldungenReject')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
