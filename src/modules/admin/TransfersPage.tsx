import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle, CheckCircle2, Clock, HelpCircle, Info, RefreshCcw, ShieldCheck, X,
} from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import { useAuth } from '../../hooks/useAuth'
import { useReportPageLoading } from '../../hooks/usePageReady'
import {
  NO_FEDERATION, countryFlag, countryLabel, formatCountryCodes, parseCountryCodes,
} from '../../utils/countries'
import { federationDisplay } from '../../utils/federations'
import { formatDateZurich, formatDateTimeCompact } from '../../utils/dateHelpers'
import { memberName, relId } from '../../utils/relations'
import type { MemberTeam, Team } from '../../types'

type Sport = 'volleyball' | 'basketball'
const SPORTS: Sport[] = ['volleyball', 'basketball']

/**
 * Stored status. Only pending/done exist — "no transfer needed" is DERIVED from
 * `federation_of_origin` ('NONE' | 'CH'), never stored, so a member's answer and
 * their workflow state can never disagree (migration 235 narrowed the CHECK).
 */
type TransferStatus = 'pending' | 'done'

/** The `members` columns this page reads. Kept explicit rather than `*` so the
 *  page never pulls IBAN / AHV / address PII it has no use for.
 *  ⚠ The four `transfer_*` columns land with migration 234 — deploy the schema
 *  BEFORE this frontend on any environment that lacks them, or Directus rejects
 *  the whole field list (CLAUDE.md → "deploy schema FIRST").
 *  ⚠ `licence_validation_date` is NOT a `members` column (it exists only on
 *  `sv_vm_check`); asking for it here would 400 the query. */
const MEMBER_FIELDS = [
  'id', 'first_name', 'last_name', 'nickname', 'email', 'birthdate',
  'license_nr', 'licence_category', 'nationalitaet_codes', 'federation_of_origin',
  'kscw_membership_active', 'licence_validated',
  'transfer_status', 'transfer_done_at', 'transfer_done_by_name', 'transfer_note',
]

interface TransferMember {
  id: string
  first_name?: string
  last_name?: string
  nickname?: string | null
  email?: string | null
  birthdate?: string | null
  license_nr?: string | null
  licence_category?: string | null
  nationalitaet_codes?: string | null
  federation_of_origin?: string | null
  kscw_membership_active?: boolean
  /** Mirrored onto `members` by vm-sync-check.mjs; `sv_vm_check` stays the source
   *  of truth. Null/undefined = Volleymanager knows no licence for this person. */
  licence_validated?: boolean | null
  transfer_status?: TransferStatus | null
  transfer_done_at?: string | null
  transfer_done_by_name?: string | null
  transfer_note?: string | null
}

interface VmRow {
  id: string
  association_id?: number | string | null
  email?: string | null
  licence_validated?: boolean | null
  licence_validation_date?: string | null
}

/**
 * Which bucket a member falls into. Derived, never stored.
 *
 * `federation_of_origin` is the association that held the member's licence **at
 * age 14** (Swiss Volley / FIVB Sports Regulations) — NOT simply the first
 * federation they ever played under. Someone licensed in Italy at 8 and by Swiss
 * Volley at 14 has federation of origin CH.
 *
 *  - `needs`  — licensed at 14 by a federation that is neither 'NONE' nor 'CH'.
 *               This maps 1:1 onto Swiss Volley's transfer trigger: an ITC is
 *               required for anyone licensed abroad at 14, "egal ob der Spieler
 *               seit längerem in der Schweiz wohnt, nur Amateur ist, keinen
 *               Vertrag hat" — including RL/JL, where the fee is CHF 0 but the
 *               transfer is still mandatory. The actionable cohort.
 *  - `settled`— 'NONE' (held no national-federation licence at 14 — a purely
 *               recreational body such as CSI/UISP/PGS is not an FIVB/FIBA
 *               member, so it answers NONE) or 'CH' (already Swiss-licensed at
 *               14, so an *international* transfer does not apply). Counted
 *               only; no control, because the state is a consequence of the
 *               federation answer rather than an independent fact.
 *  - `clarify`— never answered, but holds a non-Swiss nationality and is an
 *               active KSCW member. A question to ask, not a pending transfer.
 *               Nationality is only a heuristic for WHOM to ask — it is not the
 *               trigger; the age-14 licence is.
 *  - `ignore` — nothing to act on (Swiss nationality, or inactive).
 */
type Bucket = 'needs' | 'settled' | 'clarify' | 'ignore'

function bucketOf(m: TransferMember): Bucket {
  const fed = String(m.federation_of_origin ?? '').trim().toUpperCase()
  if (fed) return fed === NO_FEDERATION || fed === 'CH' ? 'settled' : 'needs'
  // No answer yet. Only worth chasing for active members holding a nationality
  // we know is not Swiss — a Swiss passport makes a Swiss age-14 licence by far
  // the likeliest answer, so those are not worth a chase list.
  if (!m.kscw_membership_active) return 'ignore'
  const codes = parseCountryCodes(m.nationalitaet_codes)
  if (codes.length === 0 || codes.includes('CH')) return 'ignore'
  return 'clarify'
}

interface Group {
  key: string
  label: string
  rows: TransferMember[]
}

/** Group rows by a key, ordered by member count desc, then label. */
function groupRows(
  rows: TransferMember[],
  keyOf: (m: TransferMember) => string,
  labelOf: (key: string) => string,
): Group[] {
  const byKey = new Map<string, TransferMember[]>()
  for (const m of rows) {
    const key = keyOf(m)
    const arr = byKey.get(key)
    if (arr) arr.push(m)
    else byKey.set(key, [m])
  }
  return [...byKey.entries()]
    .map(([key, keyRows]) => ({ key, label: labelOf(key), rows: keyRows }))
    .sort((a, b) => (b.rows.length - a.rows.length) || a.label.localeCompare(b.label))
}

/** Last name on line 1, first name on line 2 — the mobile name-wrap rule. */
function NameCell({ m }: { m: TransferMember }) {
  const { t } = useTranslation('admin')
  const display = (m.nickname && m.nickname.trim()) || m.first_name || ''
  return (
    // min-h keeps the row itself ≥44px on mobile even for a one-word name.
    <div className="flex min-h-[44px] min-w-0 flex-col justify-center">
      <span className="block text-sm font-medium whitespace-normal break-words text-gray-900 dark:text-white">
        {m.last_name}
      </span>
      <span className="block text-sm whitespace-normal break-words text-gray-700 dark:text-gray-300">
        {display}
      </span>
      {m.email && (
        <span className="mt-0.5 hidden text-xs break-all text-gray-400 sm:block dark:text-gray-500">
          {m.email}
        </span>
      )}
      {m.kscw_membership_active === false && (
        <span className="mt-0.5 block text-xs text-amber-600 dark:text-amber-400">
          {t('trInactive')}
        </span>
      )}
    </div>
  )
}

export default function TransfersPage() {
  const { t } = useTranslation('admin')
  const { user } = useAuth()
  const { update } = useMutation('members')

  // The active sport lives in the URL (`?sport=`) so a view is shareable and
  // survives a refresh — same idiom as FinancePage's `?tab=` and Spielplanung's
  // `?view=`. The URL is the single source of truth; an absent/unknown value
  // falls back to volleyball. `replace: true` keeps the back button pointing at
  // wherever the admin came from rather than stepping through tab switches.
  const [searchParams, setSearchParams] = useSearchParams()
  const sportParam = searchParams.get('sport')
  const sport: Sport = sportParam === 'basketball' ? 'basketball' : 'volleyball'
  const setSport = useCallback((next: Sport) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('sport', next)
      return params
    }, { replace: true })
  }, [setSearchParams])

  // ── Data ──────────────────────────────────────────────────────────
  // Sport membership is derived from the member's teams. Teams are fetched
  // WITHOUT the `active` filter on purpose: a player parked on an archived team
  // still plays that sport, and dropping them would silently hide a transfer.
  const { data: teamsRaw } = useCollection<Team>('teams', {
    fields: ['id', 'sport'],
    all: true,
    staleTime: 60_000,
  })
  const teams = useMemo(() => teamsRaw ?? [], [teamsRaw])
  const teamIds = useMemo(() => teams.map((tm) => String(tm.id)), [teams])
  const sportByTeam = useMemo(
    () => new Map<string, Team['sport']>(
      teams.map((tm) => [String(tm.id), tm.sport] as [string, Team['sport']]),
    ),
    [teams],
  )

  // ⚠ SINGLE-LEVEL junction fetch, then bucket in memory. Never
  // `members: { member_teams: { team: { sport: … } } }` — combining a frontend
  // filter that walks an M2M alias with a policy filter that walks the SAME
  // alias makes Directus return `[]` for non-admins with no error at all
  // (CLAUDE.md → "M2M deep filter + policy walk = silent empty"). A sport admin
  // is exactly such a non-admin, so the page would simply have looked empty for
  // the people it is built for. Reference impl: `useMultiTeamMembers`.
  const { data: junctionRaw } = useCollection<MemberTeam>('member_teams', {
    filter: { team: { _in: teamIds } },
    fields: ['id', 'member', 'team'],
    all: true,
    enabled: teamIds.length > 0,
    staleTime: 60_000,
  })
  const junction = useMemo(() => junctionRaw ?? [], [junctionRaw])

  // The members query touches only plain `members` columns — no junction walk at
  // all — so it is immune to the same trap by construction.
  const { data: membersRaw, refetch, isFetching } = useCollection<TransferMember>('members', {
    filter: {
      _or: [
        // Everyone who has answered. 'NONE'/'CH' answers are needed here too —
        // they feed the "no transfer needed" count.
        { federation_of_origin: { _nnull: true } },
        // Never asked, but plausibly relevant. The "no Swiss nationality" half
        // is applied client-side (`bucketOf`) because the column is a
        // comma-joined code list, not a relation we can filter precisely.
        {
          _and: [
            { federation_of_origin: { _null: true } },
            { nationalitaet_codes: { _nnull: true } },
            { kscw_membership_active: { _eq: true } },
          ],
        },
      ],
    },
    fields: MEMBER_FIELDS,
    sort: ['last_name', 'first_name'],
    all: true,
  })
  const members = useMemo(() => membersRaw ?? [], [membersRaw])

  /** memberId → the sports they play, from their team memberships. */
  const sportsByMember = useMemo(() => {
    const map = new Map<string, Set<Sport>>()
    for (const j of junction) {
      const memberId = relId(j.member)
      const teamSport = sportByTeam.get(relId(j.team))
      if (!memberId || (teamSport !== 'volleyball' && teamSport !== 'basketball')) continue
      const set = map.get(memberId)
      if (set) set.add(teamSport)
      else map.set(memberId, new Set([teamSport]))
    }
    return map
  }, [junction, sportByTeam])

  /**
   * A member with NO team membership plays no sport we can name — but they can
   * still owe a transfer, and hiding them behind a tab they never appear in is
   * the one failure mode worth avoiding here. They surface under BOTH sports;
   * the row carries a "no team" hint so the duplicate is explained rather than
   * mysterious. A genuinely dual-sport member likewise appears twice, which is
   * correct: two federations, two transfers (one shared status column is a
   * schema limit, noted so nobody reads it as a bug).
   */
  const inSport = useCallback((memberId: string, s: Sport) => {
    const set = sportsByMember.get(memberId)
    return !set || set.size === 0 || set.has(s)
  }, [sportsByMember])

  /** Per-sport buckets. Computed for BOTH sports so the tab labels carry counts. */
  const bySport = useMemo(() => {
    const empty = () => ({ needs: [] as TransferMember[], clarify: [] as TransferMember[], settled: 0 })
    const acc: Record<Sport, ReturnType<typeof empty>> = {
      volleyball: empty(),
      basketball: empty(),
    }
    for (const m of members) {
      const bucket = bucketOf(m)
      if (bucket === 'ignore') continue
      for (const s of SPORTS) {
        if (!inSport(String(m.id), s)) continue
        if (bucket === 'needs') acc[s].needs.push(m)
        else if (bucket === 'clarify') acc[s].clarify.push(m)
        else acc[s].settled += 1
      }
    }
    return acc
  }, [members, inSport])

  // ── Licence validation (volleyball only) ──────────────────────────
  // Swiss Volley validates the licence once the ITC has arrived, reconciled every
  // working day — so for a member who needs an ITC, `licence_validated = true` is
  // the downstream evidence that the transfer completed. There is no readable
  // FIVB transfer API for us (VIS gates transfer request types for guests, and
  // club access is a Swiss Volley UI login), so the Pending/Done toggle stays
  // manual and this is a cross-CHECK, not a replacement.
  //
  // Basketball has no equivalent — FIBA transfers run federation-to-federation —
  // so the whole signal is hidden on that tab rather than shown as a dead column.
  const vbNeeds = bySport.volleyball.needs
  const vmMatchKeys = useMemo(() => {
    const licences = new Set<string>()
    const emails = new Set<string>()
    for (const m of vbNeeds) {
      const lic = String(m.license_nr ?? '').trim()
      // `sv_vm_check.association_id` is an INTEGER column — a non-numeric
      // `license_nr` (they exist: hand-typed placeholders) in the `_in` list
      // makes Postgres throw on the whole query, taking the indicator down for
      // everyone. Numeric-only in, unmatched members just show "unknown".
      if (/^\d+$/.test(lic)) licences.add(lic)
      const email = String(m.email ?? '').trim().toLowerCase()
      if (email) emails.add(email)
    }
    return { licences: [...licences], emails: [...emails] }
  }, [vbNeeds])

  // Only the actionable VB cohort is looked up (tens of rows, not the whole
  // register) so the `_in` filter stays a short URL.
  const { data: vmRaw } = useCollection<VmRow>('sv_vm_check', {
    filter: {
      _or: [
        { association_id: { _in: vmMatchKeys.licences } },
        { email: { _in: vmMatchKeys.emails } },
      ],
    },
    fields: ['id', 'association_id', 'email', 'licence_validated', 'licence_validation_date'],
    all: true,
    enabled: vmMatchKeys.licences.length > 0 || vmMatchKeys.emails.length > 0,
    staleTime: 60_000,
  })

  /**
   * Volleymanager row per member, matched on the two DETERMINISTIC steps of the
   * `vm-sync-check.mjs` cascade: `association_id = license_nr`, then email. The
   * name-based tail of that cascade is deliberately NOT replicated here — it can
   * bind the wrong VM person, and a *wrong* validation date on a transfer page is
   * worse than no date at all. The boolean itself comes from `members`
   * (mirrored by the sync), so an unmatched row still shows its real status —
   * only the date goes missing.
   */
  const vmByMember = useMemo(() => {
    const rows = vmRaw ?? []
    const byLicence = new Map<string, VmRow>()
    const byEmail = new Map<string, VmRow>()
    for (const r of rows) {
      const assoc = String(r.association_id ?? '').trim()
      if (assoc) byLicence.set(assoc, r)
      const email = String(r.email ?? '').trim().toLowerCase()
      if (email && !byEmail.has(email)) byEmail.set(email, r)
    }
    const map = new Map<string, VmRow>()
    for (const m of vbNeeds) {
      const lic = String(m.license_nr ?? '').trim()
      const email = String(m.email ?? '').trim().toLowerCase()
      const row = (lic && byLicence.get(lic)) || (email && byEmail.get(email)) || null
      if (row) map.set(String(m.id), row)
    }
    return map
  }, [vmRaw, vbNeeds])

  /** Validation state shown per row. `unknown` = Volleymanager has no licence for
   *  this person at all, which is NOT the same as an explicit "not validated". */
  const validationOf = useCallback((m: TransferMember): 'validated' | 'not_validated' | 'unknown' => {
    if (m.licence_validated === true) return 'validated'
    if (m.licence_validated === false) return 'not_validated'
    return vmByMember.get(String(m.id))?.licence_validated === true ? 'validated' : 'unknown'
  }, [vmByMember])

  const showLicence = sport === 'volleyball'

  // The two mismatches. Only the first is a hard problem: a transfer recorded as
  // done whose licence is not validated means the ITC has NOT landed and the
  // player is not eligible — fielding an unvalidated licence is sanctionable
  // (FIVB Disciplinary Regulations Art. 11.4).
  const blockedRows = useMemo(
    () => (showLicence
      ? vbNeeds.filter((m) => m.transfer_status === 'done' && validationOf(m) !== 'validated')
      : []),
    [showLicence, vbNeeds, validationOf],
  )
  const probablyDoneRows = useMemo(
    () => (showLicence
      ? vbNeeds.filter((m) => m.transfer_status === 'pending' && validationOf(m) === 'validated')
      : []),
    [showLicence, vbNeeds, validationOf],
  )

  const active = bySport[sport]

  // Federation of origin drives the actionable grouping; nationality drives the
  // "to clarify" grouping, because those members have no federation answer yet.
  const needsGroups = useMemo(
    () => groupRows(
      active.needs,
      (m) => String(m.federation_of_origin ?? '').trim().toUpperCase(),
      (code) => federationDisplay(code, sport) || code,
    ),
    [active.needs, sport],
  )
  const clarifyGroups = useMemo(
    () => groupRows(
      active.clarify,
      // The primary (first) nationality. None of these members holds CH — that is
      // what put them in this bucket — so the first code is the meaningful one.
      (m) => parseCountryCodes(m.nationalitaet_codes)[0] ?? '',
      (code) => {
        const flag = countryFlag(code)
        const label = countryLabel(code) || code
        return flag ? `${flag} ${label}` : label
      },
    ),
    [active.clarify],
  )

  // ── Writes ────────────────────────────────────────────────────────
  // Note drafts live here (not in the row) so typing never triggers a
  // render-phase state write from a prop — the React #301 pattern. They are
  // intentionally never cleared: after a save the draft already equals the
  // server value, so keeping it avoids a flash of the stale row while the
  // invalidated `members` query refetches.
  const [noteDrafts, setNoteDrafts] = useState<Map<string, string>>(new Map())
  const [savingId, setSavingId] = useState<string | null>(null)

  // Legal name, not the nickname: this is an administrative attribution record,
  // the same convention as `confirmed_by_name` in game-scheduling.
  const actorName = memberName(user) || null

  const setStatus = useCallback(async (m: TransferMember, next: TransferStatus | null) => {
    setSavingId(String(m.id))
    try {
      // Both attribution columns are written on EVERY status change, never just
      // on the way in: leaving a stale `transfer_done_at` on a row that is back
      // to pending would assert a completion that no longer holds.
      const payload: Record<string, unknown> = next === 'done'
        ? {
            transfer_status: 'done',
            transfer_done_at: new Date().toISOString(),
            transfer_done_by_name: actorName,
          }
        : { transfer_status: next, transfer_done_at: null, transfer_done_by_name: null }
      // Items API (not a custom endpoint) so Directus records the actor in
      // directus_activity + the revision trail for free.
      await update(m.id, payload)
    } catch {
      toast.error(t('trSaveFailed'))
    } finally {
      setSavingId(null)
    }
  }, [actorName, update, t])

  const saveNote = useCallback(async (m: TransferMember, value: string) => {
    const trimmed = value.trim()
    if (trimmed === String(m.transfer_note ?? '').trim()) return
    setSavingId(String(m.id))
    try {
      await update(m.id, { transfer_note: trimmed || null })
    } catch {
      toast.error(t('trSaveFailed'))
    } finally {
      setSavingId(null)
    }
  }, [update, t])

  // Report to the app boot gate — see usePageReady.tsx. Keyed off `undefined`
  // (query never resolved) rather than isLoading: a DISABLED query reports
  // isLoading=false in react-query v5 and would lift the gate too early. The VM
  // lookup is deliberately NOT part of the gate — it is a secondary cross-check
  // and must never hold the whole page hostage.
  const bootLoading =
    teamsRaw === undefined || membersRaw === undefined ||
    (teamIds.length > 0 && junctionRaw === undefined)
  useReportPageLoading(bootLoading)

  if (bootLoading) return null

  const nothingToDo = active.needs.length === 0 && active.clarify.length === 0

  const statusButton = (
    m: TransferMember,
    value: TransferStatus,
    label: string,
    Icon: typeof Clock,
  ) => {
    const on = m.transfer_status === value
    return (
      <button
        type="button"
        onClick={() => { void setStatus(m, value) }}
        disabled={savingId === String(m.id)}
        aria-pressed={on}
        className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 sm:min-h-0 ${
          on
            ? value === 'done'
              ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
            : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
    )
  }

  /** Read-only licence-validation indicator + the two mismatch call-outs. */
  const licenceCell = (m: TransferMember) => {
    const state = validationOf(m)
    const validatedAt = vmByMember.get(String(m.id))?.licence_validation_date
    const blocked = m.transfer_status === 'done' && state !== 'validated'
    const probablyDone = m.transfer_status === 'pending' && state === 'validated'
    return (
      <div className="min-w-0 space-y-1">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            state === 'validated'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : state === 'not_validated'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
          }`}
        >
          {state === 'validated'
            ? t('trLicenceValidated')
            : state === 'not_validated'
              ? t('trLicenceNotValidated')
              : t('trLicenceUnknown')}
        </span>
        {state === 'validated' && validatedAt && (
          <span className="block text-xs text-gray-400 dark:text-gray-500">
            {formatDateZurich(validatedAt)}
          </span>
        )}
        {/* Destructive, not a subtle badge: this player may not be fielded. */}
        {blocked && (
          <p className="flex items-start gap-1 rounded-md bg-red-50 px-1.5 py-1 text-xs font-medium whitespace-normal text-red-700 dark:bg-red-900/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('trNotEligible')}
          </p>
        )}
        {probablyDone && (
          <div className="flex flex-col items-start gap-1 rounded-md bg-blue-50 px-1.5 py-1 dark:bg-blue-900/30">
            <p className="flex items-start gap-1 text-xs whitespace-normal text-blue-700 dark:text-blue-300">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('trProbablyDone')}
            </p>
            <button
              type="button"
              onClick={() => { void setStatus(m, 'done') }}
              disabled={savingId === String(m.id)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 sm:min-h-0 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-800/40"
            >
              {t('trMarkDone')}
            </button>
          </div>
        )}
      </div>
    )
  }

  /** One data table. `withStatus` is false for the "to clarify" cohort — those
   *  members have no federation answer yet, so there is no transfer to have a
   *  status about; the note is the place to record "asked on …". */
  const renderTable = (groups: Group[], withStatus: boolean) => (
    <div className="space-y-4">
      {groups.map((g) => (
        <div
          key={g.key || 'unknown'}
          className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50"
        >
          <div className="flex min-h-[44px] items-center gap-3 px-4 py-3">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {g.label || t('trUnknownFederation')}
            </span>
            <span className="ml-auto rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {t('trMemberCount', { count: g.rows.length })}
            </span>
          </div>
          <div className="border-t border-gray-100 dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('trColMember')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('trColNationality')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('trColLicenceNr')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('trColCategory')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('trColBirthdate')}</TableHead>
                  {withStatus && showLicence && <TableHead>{t('trColLicenceValidated')}</TableHead>}
                  {withStatus && <TableHead>{t('trColStatus')}</TableHead>}
                  <TableHead>{t('trColNote')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.rows.map((m) => {
                  const id = String(m.id)
                  const noTeam = !sportsByMember.get(id)?.size
                  return (
                    <TableRow key={id}>
                      <TableCell className="min-h-[44px] align-top">
                        <NameCell m={m} />
                        {noTeam && (
                          <span className="mt-0.5 block text-xs text-gray-400 dark:text-gray-500">
                            {t('trNoTeam')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden align-top text-xs text-gray-600 sm:table-cell dark:text-gray-300">
                        <span aria-hidden="true" className="mr-1">
                          {parseCountryCodes(m.nationalitaet_codes).map(countryFlag).join(' ')}
                        </span>
                        {formatCountryCodes(m.nationalitaet_codes)}
                      </TableCell>
                      <TableCell className="hidden align-top font-mono text-xs text-gray-600 md:table-cell dark:text-gray-300">
                        {m.license_nr || '—'}
                      </TableCell>
                      <TableCell className="hidden align-top text-xs text-gray-600 lg:table-cell dark:text-gray-300">
                        {m.licence_category || '—'}
                      </TableCell>
                      <TableCell className="hidden align-top text-xs text-gray-600 lg:table-cell dark:text-gray-300">
                        {formatDateZurich(m.birthdate) || '—'}
                      </TableCell>
                      {withStatus && showLicence && (
                        <TableCell className="align-top">{licenceCell(m)}</TableCell>
                      )}
                      {withStatus && (
                        <TableCell className="align-top">
                          {/* Stacked on phones, inline from sm — CLAUDE.md's
                              action-toggle compaction rule. */}
                          <div className="inline-flex flex-col gap-1.5 sm:flex-row sm:items-center">
                            {statusButton(m, 'pending', t('trStatusPending'), Clock)}
                            {statusButton(m, 'done', t('trStatusDone'), CheckCircle2)}
                            {m.transfer_status && (
                              <button
                                type="button"
                                onClick={() => { void setStatus(m, null) }}
                                disabled={savingId === id}
                                aria-label={t('trClearStatus')}
                                title={t('trClearStatus')}
                                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 sm:min-h-0 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                          {m.transfer_status === 'done' && m.transfer_done_at && (
                            <p className="mt-1 text-xs whitespace-normal text-gray-400 dark:text-gray-500">
                              {m.transfer_done_by_name
                                ? t('trDoneByOn', {
                                    date: formatDateTimeCompact(m.transfer_done_at),
                                    name: m.transfer_done_by_name,
                                  })
                                : t('trDoneOn', { date: formatDateTimeCompact(m.transfer_done_at) })}
                            </p>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="align-top">
                        <input
                          type="text"
                          value={noteDrafts.get(id) ?? (m.transfer_note ?? '')}
                          onChange={(e) => {
                            const next = e.target.value
                            setNoteDrafts((prev) => new Map(prev).set(id, next))
                          }}
                          // Saved on blur — an admin working down the list tabs
                          // through and every field commits itself.
                          onBlur={(e) => { void saveNote(m, e.target.value) }}
                          disabled={savingId === id}
                          placeholder={t('trNotePlaceholder')}
                          aria-label={t('trColNote')}
                          className="min-h-[44px] w-full min-w-[8rem] rounded-md border border-gray-200 bg-transparent px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none disabled:opacity-50 sm:min-h-0 dark:border-gray-600 dark:text-gray-200 dark:placeholder:text-gray-500"
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('trTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('trDescription')}</p>
        </div>
        <button
          onClick={() => { void refetch() }}
          disabled={isFetching}
          aria-busy={isFetching}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('trRefresh')}
        </button>
      </div>

      {/* Sport tabs — URL-persisted (`?sport=`) */}
      {/* A button group with aria-pressed rather than role="tablist" — there is
          no separate tabpanel per sport (the whole page re-derives), and an
          incomplete tab pattern is worse for a screen reader than an honest
          toggle group. Same shape as the app-wide SportToggle. */}
      <div
        role="group"
        aria-label={t('trTabsLabel')}
        className="mb-4 flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600"
      >
        {SPORTS.map((s, i) => {
          const open = bySport[s].needs.length + bySport[s].clarify.length
          return (
            <button
              key={s}
              type="button"
              aria-pressed={sport === s}
              onClick={() => setSport(s)}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                sport === s
                  ? 'bg-brand-100 text-brand-800 dark:bg-brand-700 dark:text-white'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'
              } ${i > 0 ? 'border-l border-gray-300 dark:border-gray-600' : ''}`}
            >
              {s === 'volleyball' ? t('trSportVolleyball') : t('trSportBasketball')}
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
                {open}
              </span>
            </button>
          )
        })}
      </div>

      {/* Eligibility alarm — the highest-value thing on this page. A transfer we
          recorded as done whose Swiss Volley licence is NOT validated means the
          ITC has not arrived and the player must not be fielded. */}
      {blockedRows.length > 0 && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/30"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">
              {t('trBlockedBanner', { count: blockedRows.length })}
            </p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
              {t('trBlockedBannerDescription')}
            </p>
          </div>
        </div>
      )}

      {probablyDoneRows.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/30">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <p className="text-xs text-blue-800 dark:text-blue-200">
            {t('trProbablyDoneBanner', { count: probablyDoneRows.length })}
          </p>
        </div>
      )}

      {/* The licence signal is a ONE-WAY implication and the wording has to say
          so, or an admin will read "not validated" as "the transfer failed". */}
      {showLicence && (
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          {t('trLicenceHint')}
        </p>
      )}

      {/* Derived "no transfer needed" tally. A count only — these members have no
          independent state to toggle; their federation answer already IS the answer. */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/30">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
        <p className="text-xs text-gray-600 dark:text-gray-300">
          <span className="font-medium">
            {t('trSettledCount', { count: active.settled })}
          </span>
          {' — '}
          {t('trSettledDescription')}
        </p>
      </div>

      {nothingToDo ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 rounded-full bg-gray-100 p-4 dark:bg-gray-800">
            <CheckCircle2 className="h-8 w-8 text-green-500" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('trEmptyTitle')}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('trEmptyDescription')}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Cohort A — actionable transfers */}
          {active.needs.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                <Clock className="h-4 w-4 text-amber-500" aria-hidden="true" />
                {t('trNeedsTitle')}
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  {active.needs.length}
                </span>
              </h2>
              <p className="mt-1 mb-3 text-sm text-gray-500 dark:text-gray-400">
                {t('trNeedsDescription')}
              </p>
              {renderTable(needsGroups, true)}
            </section>
          )}

          {/* Cohort B — never asked. Deliberately its own section with its own
              wording: this is a question to put to the member, not a transfer
              that is already running. */}
          {active.clarify.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                <HelpCircle className="h-4 w-4 text-blue-500" aria-hidden="true" />
                {t('trClarifyTitle')}
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {active.clarify.length}
                </span>
              </h2>
              <p className="mt-1 mb-3 text-sm text-gray-500 dark:text-gray-400">
                {t('trClarifyDescription')}
              </p>
              {renderTable(clarifyGroups, false)}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
