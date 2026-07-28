import { Fragment, useState, useMemo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X, ChevronDown, ChevronUp, Save, Download, FileText, ExternalLink, ArrowUpFromLine, Send, CheckCircle2, Link2, Clock, CircleAlert, Upload } from 'lucide-react'
import { useCollection, useUpdate } from '../../lib/query'
import { useAuth } from '../../hooks/useAuth'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { assetUrl, kscwApi, uploadFile } from '../../lib/api'
import { sanitizeUrl } from '../../utils/sanitizeUrl'
import TeamChip from '../../components/TeamChip'
import ClubdeskMemberSyncButton from './components/ClubdeskMemberSyncButton'
import ClubdeskSyncUpModal from './components/ClubdeskSyncUpModal'
import ClubdeskRegistrationZone from './components/ClubdeskRegistrationZone'
import { Button } from '../../components/ui/button'
import { formatDate } from '../../utils/dateHelpers'
import { localizeCountryName } from '../../utils/countryName'
import {
  countryNameDe, countryOptions,
  parseCountryCodes, serializeCountryCodes, NO_FEDERATION,
} from '../../utils/countries'
import CountryMultiSelect from '../../components/CountryMultiSelect'
import SearchableSelect from '../../components/ui/SearchableSelect'
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
  // Legacy singular code (migration 161) — kept as the FIRST entry of
  // nationalitaet_codes so single-code consumers keep working (migration 223).
  nationalitaet_code: string | null
  nationalitaet_codes: string | null
  federation_of_origin: string | null
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
  iban: string | null
  kantonsschule: string | null
  locale: string | null
  rejection_reason: string | null
  bb_situation: string | null
  bb_doc_lizenz: string | null
  bb_doc_freibrief: string | null
  bb_doc_selfdecl: string | null
  bb_doc_natdecl: string | null
  bb_doc_u18parents: string | null
  bb_doc_schoolcert: string | null
  id_upload_front: string | null
  id_upload_back: string | null
  sektion_choice: string | null
}

// All document fields a registration can carry (BB docs + ID front/back)
// Private quarantine folder for registration documents (migration 169; same UUID on
// every environment). Mirrors REGISTRATION_FILES_FOLDER in kscw-endpoints.
const REGISTRATION_FILES_FOLDER = 'a0000167-0000-4000-8000-000000000001'
const DOC_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
const DOC_UPLOAD_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

const DOC_FIELDS: (keyof Registration)[] = [
  'bb_doc_lizenz',
  'bb_doc_freibrief',
  'bb_doc_selfdecl',
  'bb_doc_natdecl',
  'bb_doc_u18parents',
  'bb_doc_schoolcert',
  'id_upload_front',
  'id_upload_back',
]

// Required basketball documents for a licensing situation. Mirrors bbRequiredDocs
// in the Directus extension (wiedisync bb-docs.js) and the kscw-website client —
// keep the four in sync. School certificate stays optional (never required).
const BB_SITUATIONS = ['neu', 'transfer_ch', 'transfer_intl', 'rueckkehr']
const bbIsMinor = (dob: string | null): boolean => {
  if (!dob) return false
  const m = dob.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const now = new Date()
  const seasonStartYear = now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  let age = seasonStartYear - Number(m[1])
  if (9 < Number(m[2]) || (9 === Number(m[2]) && 1 < Number(m[3]))) age--
  return age < 18
}
const bbRequiredDocs = (
  situation: string | null,
  natCode: string,
  dob: string | null,
): (keyof Registration)[] => {
  const base: (keyof Registration)[] = ['id_upload_front', 'id_upload_back', 'bb_doc_lizenz']
  const foreign = !!natCode && natCode !== 'CH'
  const minor = bbIsMinor(dob)
  if (!BB_SITUATIONS.includes(situation || '')) {
    if (foreign) base.push('bb_doc_selfdecl', 'bb_doc_natdecl')
    return base
  }
  switch (situation) {
    case 'transfer_ch':
      base.push('bb_doc_freibrief')
      break
    case 'transfer_intl':
    case 'rueckkehr':
      base.push('bb_doc_selfdecl')
      if (minor) base.push('bb_doc_natdecl', 'bb_doc_u18parents')
      break
    default:
      if (foreign) base.push('bb_doc_selfdecl')
      if (foreign && minor) base.push('bb_doc_natdecl')
      break
  }
  return base
}
// The single code the document gate judges a (possibly multi-) national by.
// FIBA treats a dual national holding Swiss nationality as Swiss, so a CH code
// ANYWHERE in the list clears the foreign-player documents — the list order is
// a UI convention, not a legal one. Mirrors fibaNatCode in bb-docs.js; the
// singular code covers rows that predate the list (migration 223).
const fibaNatCode = (reg: Registration): string => {
  const codes = parseCountryCodes(reg.nationalitaet_codes)
  if (codes.includes('CH')) return 'CH'
  return codes[0] || (reg.nationalitaet_code || '').trim().toUpperCase().slice(0, 2)
}

const countDocs = (reg: Registration): number => DOC_FIELDS.filter((k) => reg[k]).length


type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

// ── CSV export (ClubDesk format) ───────────────────────────────
function csvEscape(val: string): string {
  let s = String(val ?? '')
  // Neutralize CSV formula injection: prefix a leading formula trigger with an
  // apostrophe so spreadsheet apps treat attacker-controlled cells as text.
  // Don't mangle legit signed numbers / phones (-50, +41…) — only real formulas.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d/.test(s)) s = "'" + s
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
  a.download = `registrations_clubdesk_${new Date().toISOString().slice(0, 10)}.csv`
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

  // ClubDesk status badges for the OVERVIEW rows (approved registrations,
  // superadmin only) — one batch call instead of per-row fetches; the expanded
  // zone still does its own fresh check before offering actions.
  const [cdStatuses, setCdStatuses] = useState<Record<string, { status: string }>>({})
  useEffect(() => {
    if (!isGlobalAdmin) return
    const ids = (registrationsRaw ?? []).filter((r) => r.status === 'approved').map((r) => r.id)
    if (!ids.length) return
    let alive = true
    kscwApi<{ statuses: Record<string, { status: string }> }>('/clubdesk-registration-status/batch', {
      method: 'POST',
      body: { registration_ids: ids },
    })
      .then((res) => { if (alive) setCdStatuses(res.statuses ?? {}) })
      .catch(() => { /* badge is best-effort — the expanded zone still works */ })
    return () => { alive = false }
  }, [isGlobalAdmin, registrationsRaw])

  const cdBadge = (reg: Registration) => {
    if (reg.status !== 'approved') return null
    const st = cdStatuses[String(reg.id)]
    if (!st) return null
    const map: Record<string, { icon: typeof CheckCircle2; cls: string; label: string }> = {
      linked: { icon: CheckCircle2, cls: 'text-green-600 dark:text-green-400', label: t('cdRegLinked') },
      match_unlinked: { icon: Link2, cls: 'text-amber-600 dark:text-amber-400', label: t('cdRegMatchUnlinked') },
      pushed_pending: { icon: Clock, cls: 'text-blue-600 dark:text-blue-400', label: t('cdRegPushedPending') },
      not_in_clubdesk: { icon: CircleAlert, cls: 'text-amber-600 dark:text-amber-400', label: t('cdRegNotIn') },
      no_member: { icon: CircleAlert, cls: 'text-gray-400 dark:text-gray-500', label: t('cdRegNoMember') },
    }
    const m = map[st.status]
    if (!m) return null
    const Icon = m.icon
    return (
      <span className={`inline-flex items-center gap-0.5 text-xs ${m.cls}`} title={m.label}>
        <Icon className="h-3 w-3 shrink-0" />
        <span className="hidden sm:inline">CD</span>
      </span>
    )
  }

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

  // Required docs for a basketball registration, driven by the applicant's
  // licensing situation + nationality + age. Mirrors the server-side approval
  // gate (kscw-hooks) — this check just gives a clear toast instead of a failed
  // request.
  const missingRequiredDocs = (reg: Registration): (keyof Registration)[] => {
    if (reg.membership_type !== 'basketball') return []
    return bbRequiredDocs(reg.bb_situation, fibaNatCode(reg), reg.geburtsdatum).filter((k) => !reg[k])
  }

  const handleApprove = (reg: Registration) => {
    const missing = missingRequiredDocs(reg)
    if (missing.length) {
      toast.error(t('anmeldungenDocsMissingBlock', { count: missing.length }))
      return
    }
    updateReg({ id: reg.id, data: { status: 'approved' } }, {
      onSuccess: () => toast.success(t('anmeldungenApprovedToast')),
    })
  }

  const openRejectModal = (reg: Registration) => {
    setRejectTarget(reg)
    setRejectReason('')
  }

  // Resend the WiediSync signup invite for an approved registration — the
  // backend resolves the member by the registration's email and emails a fresh
  // single-use token (never returned to the client).
  const [resendingId, setResendingId] = useState<string | null>(null)
  const handleResendInvite = async (reg: Registration) => {
    if (resendingId) return
    setResendingId(reg.id)
    try {
      const res = await kscwApi<{ email: string }>('/signup-invites/create', {
        method: 'POST',
        body: { registration_id: reg.id },
      })
      toast.success(t('anmeldungenInviteSent', { email: res.email ?? reg.email }))
    } catch (err) {
      const apiErr = err as Error & { code?: string }
      if (apiErr.code === 'already_claimed') toast.error(t('anmeldungenInviteAlreadyClaimed'))
      else if (apiErr.code === 'no_email') toast.error(t('anmeldungenInviteNoEmail'))
      else if (String(apiErr.message).endsWith('404')) toast.error(t('anmeldungenInviteNoMember'))
      else toast.error(t('anmeldungenInviteError'))
    } finally {
      setResendingId(null)
    }
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
                                <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                                  <span className="block sm:inline font-medium text-gray-900 dark:text-gray-100">{reg.nachname}{reg.vorname ? ',' : ''}</span>
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
                                      {t('anmeldungenDocsCount', { count: countDocs(reg) })}
                                    </span>
                                  )}
                                  {cdBadge(reg)}
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
                                  {cdBadge(reg)}
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
                                    onResendInvite={() => handleResendInvite(reg)}
                                    onPreviewFile={setPreviewFile}
                                    isUpdating={isUpdating}
                                    isResending={resendingId === reg.id}
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
  const { t } = useTranslation('admin')
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
          alt={t('anmeldungenDocAlt')}
          className="max-h-[70vh] w-auto rounded-md border border-gray-200 dark:border-gray-700"
          onError={() => setIsImage(false)}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 py-8 text-gray-500 dark:text-gray-400">
          <FileText className="h-12 w-12" />
          <p className="text-sm">{t('anmeldungenPdfOpenTab')}</p>
        </div>
      )}
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {t('openInNewTab')}
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
  onResendInvite,
  onPreviewFile,
  isUpdating,
  isResending,
}: {
  reg: Registration
  t: (key: string) => string
  onSave: (data: Partial<Registration>) => void
  onApprove: () => void
  onReject: () => void
  onResendInvite: () => void
  onPreviewFile: (file: { url: string; label: string }) => void
  isUpdating: boolean
  isResending: boolean
}) {
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [uploadingKey, setUploadingKey] = useState<keyof Registration | null>(null)
  const hasChanges = Object.keys(edits).length > 0
  // `t` (prop) is the admin namespace; the coded pickers reuse hint/placeholder
  // strings that live in auth + common.
  const { t: tAll } = useTranslation(['admin', 'auth', 'common'])

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

  const codedLabel = (label: string) => (
    <label className="mb-0.5 block text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
  )

  // Shared onChange for the coded pickers below. Tracks the same "back to the
  // stored value clears the edit" rule as field(), so saving stays disabled
  // when a picker is opened and closed on the value it already had.
  const setCoded = (key: keyof Registration, next: string, original: string) => {
    const edited = { ...edits }
    if (next === original) delete edited[key]
    else edited[key] = next
    setEdits(edited)
  }

  // Nationality and federation of origin are CODED (ISO alpha-2 + a CHECK
  // constraint), so they get pickers rather than field()'s text box — typing
  // "Schwiiz" would write something the CHECK rejects. Same components the
  // member explorer uses, so both admin screens edit these the same way.
  //
  // Nationality is a code LIST since migration 223 ("CH,IT", first = primary).
  // Legacy rows carry only the singular code or the submitter-language free
  // text, so both fallbacks stay for DISPLAY; editing always writes the list.
  const nationalityField = () => {
    const stored = reg.nationalitaet_codes
      ?? (reg.nationalitaet_code ? reg.nationalitaet_code.trim().toUpperCase().slice(0, 2) : '')
    const value = edits.nationalitaet_codes ?? stored
    return (
      <div>
        {codedLabel(t('anmeldungenNationality'))}
        {/* A legacy row with only free text has nothing to preselect — show what
            it says so the editor knows what they are replacing. */}
        {!value && reg.nationalitaet && (
          <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">{localizeCountryName(reg.nationalitaet)}</div>
        )}
        <CountryMultiSelect
          selected={parseCountryCodes(value)}
          onChange={(codes) => setCoded('nationalitaet_codes', serializeCountryCodes(codes) ?? '', stored)}
          helperText={tAll('auth:nationalitaetHint')}
        />
      </div>
    )
  }

  // 'NONE' = explicitly never licensed elsewhere; empty = simply not asked
  // (every registration predating the field) → show nothing, not "None".
  const federationField = () => {
    const stored = (reg.federation_of_origin ?? '').trim().toUpperCase()
    const value = edits.federation_of_origin ?? stored
    return (
      <div>
        {codedLabel(t('anmeldungenFederation'))}
        <SearchableSelect
          options={[{ value: NO_FEDERATION, label: t('federationNone') }, ...countryOptions()]}
          value={value}
          onChange={(v) => setCoded('federation_of_origin', v, stored)}
          searchPlaceholder={tAll('common:searchCountry')}
        />
      </div>
    )
  }

  // Editable <select> variant of field() — used for the passive-member Sektion
  // choice (Volleyball/Basketball/KSCW), which the approver picks and the
  // ClubDesk create-push then sends as the Sektion column.
  const selectField = (key: keyof Registration, label: string, choices: string[]) => {
    const original = (reg[key] as string) ?? ''
    const value = edits[key] ?? original
    return (
      <div>
        <label className="mb-0.5 block text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
        <select
          value={value}
          onChange={(e) => {
            const v = e.target.value
            const next = { ...edits }
            if (v === original) delete next[key]
            else next[key] = v
            setEdits(next)
          }}
          className="w-full rounded-md border border-gray-200 bg-transparent px-2.5 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">—</option>
          {choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    )
  }

  const handleSave = () => {
    if (!hasChanges) return
    const data: Record<string, string | null> = { ...edits }

    // The coded columns carry CHECK constraints that accept NULL but not '' —
    // a cleared picker must send null or the PATCH fails.
    for (const key of ['nationalitaet_codes', 'federation_of_origin']) {
      if (data[key] === '') data[key] = null
    }

    // `registrations` has no trigger mirroring the code list onto the two
    // derived nationality columns (only `members` does, migration 223), so this
    // does what that trigger would. It matters: the ClubDesk CSV export pushes
    // the free-text `nationalitaet`, and the basketball document gate reads the
    // singular `nationalitaet_code` — leaving either stale would file the
    // member under their OLD nationality after an admin corrected it here.
    if ('nationalitaet_codes' in data) {
      const primary = parseCountryCodes(data.nationalitaet_codes ?? '')[0] ?? null
      data.nationalitaet_code = primary
      // ClubDesk's Nationalität is a single-value German picklist, so this must
      // be the ClubDesk spelling of the PRIMARY code, not a localized display
      // name (countryNameDe carries the picklist overrides).
      data.nationalitaet = primary ? countryNameDe(primary) : null
    }

    onSave(data as Partial<Registration>)
    setEdits({})
  }

  const bbDocs: { key: keyof Registration; label: string }[] = [
    { key: 'bb_doc_lizenz', label: t('anmeldungenDocLizenz') },
    { key: 'bb_doc_freibrief', label: t('anmeldungenDocFreibrief') },
    { key: 'bb_doc_selfdecl', label: t('anmeldungenDocSelfDecl') },
    { key: 'bb_doc_natdecl', label: t('anmeldungenDocNatDecl') },
    { key: 'bb_doc_u18parents', label: t('anmeldungenDocU18Parents') },
    { key: 'bb_doc_schoolcert', label: t('anmeldungenDocSchoolCert') },
  ]
  const idDocs: { key: keyof Registration; label: string }[] = [
    { key: 'id_upload_front', label: t('anmeldungenDocIdFront') },
    { key: 'id_upload_back', label: t('anmeldungenDocIdBack') },
  ]

  // Attach (or replace) a registration document. Needed because the 2026-07-06..07-13
  // upload-truncation bug destroyed 36 documents and there was no way to put them back:
  // the public /registration/:id/files route only accepts PENDING registrations, and the
  // affected five were already approved.
  //
  // Uploads via the core POST /files helper (multipart), NOT the custom
  // /kscw/registration/upload route — the core path is what the truncation bug never
  // touched. `folder` drops it straight into the private registration folder, so the doc
  // is born quarantined (the kscw-hooks sweep would move it there anyway, but being
  // explicit means it is never briefly public).
  const handleDocUpload = async (key: keyof Registration, file: File) => {
    if (file.size > DOC_UPLOAD_MAX_BYTES) {
      toast.error(t('anmeldungenDocTooLarge'))
      return
    }
    if (!DOC_UPLOAD_MIME.includes(file.type)) {
      toast.error(t('anmeldungenDocBadType'))
      return
    }
    setUploadingKey(key)
    try {
      const { id } = await uploadFile(file, REGISTRATION_FILES_FOLDER)
      onSave({ [key]: id } as Partial<Registration>)
    } catch {
      toast.error(t('anmeldungenDocUploadFailed'))
    } finally {
      setUploadingKey(null)
    }
  }

  const renderDoc = ({ key, label }: { key: keyof Registration; label: string }) => {
    const fileId = reg[key] as string | null
    const busy = uploadingKey === key

    const picker = (children: React.ReactNode, className: string) => (
      <label className={className} aria-busy={busy}>
        {children}
        <input
          type="file"
          className="sr-only"
          accept={DOC_UPLOAD_MIME.join(',')}
          disabled={busy || isUpdating}
          onChange={(e) => {
            const f = e.target.files?.[0]
            // Reset so re-picking the same file fires onChange again.
            e.target.value = ''
            if (f) void handleDocUpload(key, f)
          }}
        />
      </label>
    )

    if (!fileId) {
      return (
        <div key={key} className="flex min-h-11 items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-400 dark:border-gray-600">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
          {picker(
            <span className="ml-auto flex items-center gap-1 whitespace-nowrap text-xs font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300">
              <Upload className="h-3.5 w-3.5" />
              {busy ? t('anmeldungenDocUploading') : t('anmeldungenDocUpload')}
            </span>,
            'ml-auto cursor-pointer',
          )}
        </div>
      )
    }

    const url = assetUrl(fileId)
    return (
      <div key={key} className="flex min-h-11 items-center gap-2 rounded-md border border-orange-200 bg-orange-50 pr-2 text-sm text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300">
        <button
          onClick={() => onPreviewFile({ url, label })}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:underline"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        </button>
        {picker(
          <span className="flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-1 text-xs font-medium hover:bg-orange-100 dark:hover:bg-orange-900">
            <Upload className="h-3.5 w-3.5" />
            {busy ? t('anmeldungenDocUploading') : t('anmeldungenDocReplace')}
          </span>,
          'cursor-pointer',
        )}
      </div>
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
        {nationalityField()}
        {federationField()}
        {field('geschlecht', t('anmeldungenGender'), { display: localizeGender })}
        {field('rolle', t('anmeldungenFunction'))}
        {field('team', t('anmeldungenTeam'))}
        {field('beitragskategorie', t('anmeldungenFeeCategory'))}
        {field('lizenz', t('anmeldungenLicence'))}
        {field('schiedsrichter_stufe', t('anmeldungenRefLevel'))}
        {field('kantonsschule', t('anmeldungenSchool'))}
        {field('ahv_nummer', 'AHV')}
        {/* Payout IBAN (reimbursements only, migration 185) — pre-validated mod-97 at submission */}
        {field('iban', 'IBAN')}
        {/* Passive members have no sport → the approver picks the ClubDesk Sektion */}
        {reg.membership_type === 'passive' && selectField('sektion_choice', t('anmeldungenSektion'), ['Volleyball', 'Basketball', 'KSCW'])}
        {field('bemerkungen', t('anmeldungenNotes'), { full: true })}
        {reg.membership_type === 'basketball' && (
          <div>
            <label className="mb-0.5 block text-xs font-medium text-gray-500 dark:text-gray-400">{t('anmeldungenSituation')}</label>
            <div className="px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100">
              {(
                {
                  neu: t('anmeldungenSituationNew'),
                  transfer_ch: t('anmeldungenSituationTransferCH'),
                  transfer_intl: t('anmeldungenSituationTransferIntl'),
                  rueckkehr: t('anmeldungenSituationReturner'),
                } as Record<string, string>
              )[reg.bb_situation || ''] || '—'}
            </div>
          </div>
        )}
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

      {/* ClubDesk sync zone — approved registrations only (superadmin; the
          component hides itself for non-superadmins) */}
      {reg.status === 'approved' && <ClubdeskRegistrationZone registrationId={String(reg.id)} />}

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
        ) : reg.status === 'approved' ? (
          <button
            onClick={onResendInvite}
            disabled={isResending || isUpdating}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            title={t('anmeldungenResendInvite')}
          >
            <Send className="h-3.5 w-3.5" />
            {t('anmeldungenResendInvite')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
