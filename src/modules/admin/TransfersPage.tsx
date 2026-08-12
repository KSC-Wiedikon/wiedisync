import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangle, Check, CheckCircle2, ChevronRight, Clock, Copy, ExternalLink, HelpCircle,
  Info, Mail, RefreshCcw, RadioTower, ShieldCheck, X,
} from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../../components/ui/table'
import { useCollection } from '../../lib/query'
import { kscwApi } from '../../lib/api'
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

/**
 * VOLLEYBALL ONLY — the page had a sport toggle and no longer does.
 *
 * Everything this page is made of belongs to FIVB's apparatus: the VIS player
 * index, the VIS federation directory, the prepared letters, and the Swiss
 * Volley licence cross-check. A FIBA transfer runs federation to federation
 * through Swiss Basketball and is not worked from here, so a basketball tab
 * could only ever show a worklist nobody works, addressed to the wrong
 * governing body. Basketball players are COUNTED in the header
 * (`trHiddenBasketball`) rather than dropped in silence.
 */
const SPORT: Team['sport'] = 'volleyball'

/**
 * Volleyball teams whose players need no international transfer, by exact team
 * name. Swiss Volley's U20 championship sits outside the ITC regime, so a
 * member who plays only there is on nobody's worklist.
 *
 * ⚠ The exemption is per TEAM, not per person: an HU20 player who also plays
 * 2. Liga still needs the transfer for that licence. So it only fires when
 * EVERY volleyball team the member plays for is on this list.
 *
 * ⚠ Exact names, deliberately not a `U\d+` pattern — U23 is NOT exempt. MiniVB
 * would be, but it has no roster at all; add it here if the programme returns.
 */
const NO_TRANSFER_VB_TEAM_NAMES = new Set(['DU20', 'HU20'])

/**
 * `GET /kscw/admin/vis-player-check`. `result` is the LAST finished run in this
 * container's lifetime, so it is null on a cold start even when `last` (the
 * `sync_runs` heartbeat) has a date — the two answer different questions and
 * only `result` carries the per-run tallies.
 */
type VisCheckStatus = {
  running: boolean
  startedAt: string | null
  configured: boolean
  result: { ok: boolean; checked?: number; inVis?: number; notFound?: number; error?: string } | null
}

/**
 * The VIS transfers app. There is NO per-player URL — VIS routes everything
 * through an in-app search — so this is deliberately the plain entry point and
 * the player number is offered as a copyable value next to it. Inventing a
 * `?playerNo=` style link would produce a dead end that looks authoritative.
 */
const VIS_TRANSFERS_URL = 'https://app.fivb.com/volley/transfers/'

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
  // VIS presence (migration 240). Same deploy-order caveat as the transfer_*
  // block above: this list is explicit, so a column that is not named here
  // simply arrives `undefined` — which would make every member read as
  // "not checked" with no error anywhere to explain it.
  'in_vis', 'vis_player_no', 'in_vis_checked_at',
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
  /**
   * Presence in the FIVB VIS player index of the member's federation of origin,
   * written by `vis-player-check.mjs` (migration 240).
   *
   *  - `true`      — found; a transfer can be requested for them.
   *  - `false`     — NOT found. ⚠ Evidence, not proof, and the UI must never say
   *                  otherwise: the check matches on a normalised name, and
   *                  `federation_of_origin` was SEEDED from nationality for most
   *                  members (migration 239). So a `false` far more often means
   *                  the seeded origin was wrong — the person was never licensed
   *                  in their passport country at all — than that a federation
   *                  has failed to enter them. Read as "no evidence they were
   *                  ever licensed there". For a CH-origin member it blocks
   *                  nothing at all — no international transfer applies — so it
   *                  is worded differently there (`trSwissInVisNoHint`).
   *  - null/undef. — never checked. CH-origin members USED to be skipped by
   *                  design; they are checked against Swiss Volley's own VIS
   *                  index (fed 189/SUI) since the Swiss group was introduced,
   *                  so a Swiss row reading "not checked" just means the monthly
   *                  job has not run since.
   */
  in_vis?: boolean | null
  /** FIVB VIS player number, present when `in_vis` is true. The only stable
   *  identifier VIS exposes for a person, and the value to paste into its search. */
  vis_player_no?: number | null
  in_vis_checked_at?: string | null
}

/**
 * A national federation as VIS publishes it (migration 241, 69 rows). `iso` is
 * the ISO alpha-2 that matches `members.federation_of_origin`; the FIVB `code`
 * is IOC-style and NOT derivable from it (DE→GER, NL→NED), which is why the
 * table stores both.
 */
interface VisFederation {
  vis_no: number
  iso: string
  code?: string | null
  name: string
  email?: string | null
  website?: string | null
}

interface VmRow {
  id: string
  association_id?: number | string | null
  email?: string | null
  licence_validated?: boolean | null
  licence_validation_date?: string | null
  /** German country name — the person's CITIZENSHIP as Volleymanager records it. */
  nationality?: string | null
  /**
   * IOC alpha-3 PLAYING nationality of the licence. 'SUI' on a foreign citizen
   * means Swiss Volley already counts them as Swiss for eligibility — it does
   * NOT mean Swiss citizenship, and neither column is a federation of origin
   * (Volleymanager stores none; its `federation` column is the REGIONAL
   * association of the current licence club). Shown for comparison only, never
   * fed back into `federation_of_origin`.
   */
  nationality_code?: string | null
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
 *  - `swiss`  — 'CH': Swiss Volley held the age-14 licence, so no INTERNATIONAL
 *               transfer applies. Split out from `settled` because Swiss Volley
 *               is a federation in VIS with its own player index exactly like
 *               the others (`vis_federations` vis_no 189 / SUI) — so these
 *               members can be grouped, contacted and VIS-checked under it
 *               rather than disappearing into a bare tally. No transfer control:
 *               there is no transfer to have a status about.
 *  - `settled`— 'NONE' — held no national-federation licence at 14, because a
 *               purely recreational body such as CSI/UISP/PGS is not an
 *               FIVB/FIBA member. Counted only; there is no federation to group
 *               them under and no index to look them up in.
 *  - `clarify`— never answered, but holds a non-Swiss nationality and is an
 *               active KSCW member. A question to ask, not a pending transfer.
 *               Nationality is only a heuristic for WHOM to ask — it is not the
 *               trigger; the age-14 licence is.
 *  - `ignore` — nothing to act on (Swiss nationality, or inactive).
 */
type Bucket = 'needs' | 'swiss' | 'settled' | 'clarify' | 'ignore'

function bucketOf(m: TransferMember): Bucket {
  const fed = String(m.federation_of_origin ?? '').trim().toUpperCase()
  if (fed === 'CH') return 'swiss'
  if (fed) return fed === NO_FEDERATION ? 'settled' : 'needs'
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

/**
 * What a rendered group of members is, which decides every column and control
 * in it. One value per cohort — see `renderTable` for the full mapping.
 */
type TableMode = 'needs' | 'clarify' | 'swiss'

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

/**
 * VIS publishes federation contacts as a SEMICOLON-SEPARATED LIST
 * ("presidenza@federvolley.it; segreteria@federvolley.it") and migration 241
 * keeps that verbatim, so anything reading `email` has to split it. Which of
 * them is the right addressee for a transfer request is a judgement the club
 * makes — hence all of them are shown, not just the first.
 */
function splitEmails(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * VIS stores federation names in ALL CAPS ("GERMAN VOLLEYBALL FEDERATION").
 * Acceptable as a table label, but it shouts in a letter we send to that
 * federation — so it is title-cased for display, lowercasing the connectors
 * title case would otherwise capitalise ("FEDERACIÓN ESPAÑOLA DE VOLEIBOL" →
 * "Federación Española de Voleibol"). A name VIS already stores mixed-case
 * ("Nederlandse Volleybalbond (Nevobo)") is trusted exactly as it is.
 *
 * ⚠ Deliberately NO "short tokens are acronyms" rule. It is the obvious guess
 * and it is wrong for this data: across all 69 rows the directory holds long-
 * form names only, so every short token is either a connector or a real word —
 * "VOLLEYBALL NEW ZEALAND INC." and "SRI LANKA …" would come out as "NEW" and
 * "SRI". Federations that genuinely spell themselves in capitals go in
 * FED_KEEP_UPPER by name.
 */
const FED_KEEP_UPPER = new Set(['FIVB', 'FIBA', 'CEV', 'NORCECA', 'CAVB', 'CSV', 'AVC'])
const FED_LOWER = new Set([
  'DE', 'DI', 'DA', 'DEL', 'DES', 'DU', 'LA', 'LE', 'EL', 'OF', 'AND', 'Y', 'E', 'IL',
  'VAN', 'DER', 'DEN', 'DELLA',
])
function prettyFederationName(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s || s !== s.toUpperCase()) return s
  return s.replace(/[\p{L}\p{M}'’]+/gu, (word, offset: number) => {
    if (FED_KEEP_UPPER.has(word)) return word
    // A connector only reads as one mid-sentence; leading it stays capitalised.
    if (offset > 0 && FED_LOWER.has(word)) return word.toLowerCase()
    return word[0] + word.slice(1).toLowerCase()
  })
}

/** "Tobias Armstrong, date of birth 07.08.1994, to.armstr@gmail.com" — exactly
 *  the identity a federation needs to find or create the player. */
function memberRequestLine(m: TransferMember): string {
  const name = [m.first_name, m.last_name].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ')
  const parts = [name || '(name)']
  const dob = formatDateZurich(m.birthdate)
  if (dob) parts.push(`date of birth ${dob}`)
  const email = String(m.email ?? '').trim()
  if (email) parts.push(email)
  return parts.join(', ')
}

/**
 * The text an admin copies into their own mail client to ask a federation to
 * enter players in VIS. Nothing is ever sent from this page.
 *
 * ONE letter per federation, listing every player of theirs we cannot open a
 * transfer for yet — a federation that has to answer 24 near-identical emails
 * about the same club answers none of them.
 *
 * ⚠ ALWAYS ENGLISH, deliberately not translated (same reasoning as the exports
 * rule): the recipient is a foreign national federation, and the language the
 * KSCW admin happens to read the app in says nothing about what that federation
 * reads. English is the FIVB working language.
 *
 * ⚠ The wording ASKS whether the players are registered rather than asserting
 * they are missing. `in_vis === false` is a name-match miss against a federation
 * we usually only GUESSED (seeded from nationality), and never-checked members
 * are on the same list — so an accusatory "your players are missing from VIS"
 * would frequently be simply untrue.
 */
function visRequestText(rows: TransferMember[], federationName: string): string {
  const one = rows.length === 1
  const list = one
    ? [memberRequestLine(rows[0])]
    : rows.map((m, i) => `${i + 1}. ${memberRequestLine(m)}`)
  return [
    'Dear Sir or Madam',
    '',
    one
      ? 'The player below plays for KSC Wiedikon in Zurich, Switzerland, and we would like to request an international transfer to Swiss Volley.'
      : `The ${rows.length} players below play for KSC Wiedikon in Zurich, Switzerland, and we would like to request international transfers to Swiss Volley for them.`,
    `Could you please confirm whether ${one ? 'the player is' : 'they are'} registered in the FIVB VIS player index of ${federationName}, and enter ${one ? 'them if they are not' : 'those who are not'}? We cannot open a transfer request before a player appears in VIS.`,
    '',
    ...list,
    '',
    'Thank you very much and kind regards',
    'KSC Wiedikon, Zurich (Switzerland)',
  ].join('\n')
}

/** Subject line for the prepared request. English, for the same reason the body is. */
const VIS_REQUEST_SUBJECT =
  'International transfer to Swiss Volley — request to register KSC Wiedikon players in VIS'

/**
 * Some mail clients silently TRUNCATE an over-long `mailto:` — which would send
 * a letter missing its last players while looking complete. Past this length the
 * body is dropped from the link (recipient + subject only) and the admin pastes
 * the copied text in; 1800 sits under the ~2048 Windows hands to a mail client.
 * For scale: 5 players prefill comfortably, 16 do not.
 */
const MAILTO_MAX = 1800

/**
 * Copy-to-clipboard button. Icon-only when no `label` is given, so it fits
 * inline next to a value inside a table cell.
 *
 * The transient tick is local state rather than a toast: the three things this
 * page copies (player number, address, request text) are often copied one after
 * another, and three stacked toasts obscure the table they came from. A FAILED
 * copy still toasts — clipboard access can be denied (insecure context, browser
 * permission) and silence there would leave the admin pasting nothing.
 */
function CopyButton({ value, title, label }: { value: string; title: string; label?: string }) {
  const { t } = useTranslation('admin')
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      // Cosmetic only — if the row unmounts first React drops the update.
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('trCopyFailed'))
    }
  }
  return (
    <button
      type="button"
      onClick={() => { void copy() }}
      title={title}
      aria-label={title}
      className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 sm:min-h-0 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      {copied
        ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />
        : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {label && <span>{copied ? t('trCopied') : label}</span>}
    </button>
  )
}

/**
 * Last name on line 1, first name on line 2 — the mobile name-wrap rule.
 *
 * Carries the whole identity a federation is asked to match on (name, birthdate,
 * email), which is why the birthdate lives here rather than in a column of its
 * own: it is not an attribute of the transfer, it is how the player is found.
 */
function NameCell({ m, teamNames }: { m: TransferMember; teamNames?: string[] }) {
  const { t } = useTranslation('admin')
  const display = (m.nickname && m.nickname.trim()) || m.first_name || ''
  const dob = formatDateZurich(m.birthdate)
  return (
    // min-h keeps the row itself ≥44px on mobile even for a one-word name.
    <div className="flex min-h-[44px] min-w-0 flex-col justify-center">
      <span className="block text-sm font-medium whitespace-normal break-words text-gray-900 dark:text-white">
        {m.last_name}
      </span>
      <span className="block text-sm whitespace-normal break-words text-gray-700 dark:text-gray-300">
        {display}
      </span>
      {dob && (
        <span className="text-xs text-gray-500 dark:text-gray-400" title={t('trColBirthdate')}>
          {dob}
        </span>
      )}
      {teamNames && teamNames.length > 0 && (
        <span
          className="text-xs whitespace-normal text-brand-600 dark:text-brand-400"
          title={t('trColTeams')}
        >
          {teamNames.join(', ')}
        </span>
      )}
      {m.email && (
        <span className="hidden text-xs break-all text-gray-400 sm:block dark:text-gray-500">
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
  const { user, hasAdminAccessToSport } = useAuth()
  /**
   * Who may TRIGGER the VIS check — the same set the endpoint's gate admits
   * (global admin / superuser / vb_admin), and deliberately narrower than who
   * may READ this page: `isAdmin` includes `bb_admin`, VIS is FIVB's index, and
   * a button that is visible but 403s is worse than one that is absent.
   */
  const canRunVisCheck = hasAdminAccessToSport('volleyball')
  const { update } = useMutation('members')

  // ── Data ──────────────────────────────────────────────────────────
  // Sport membership is derived from the member's teams. Teams are fetched
  // WITHOUT the `active` filter on purpose: a player parked on an archived team
  // still plays that sport, and dropping them would silently hide a transfer.
  // `active` is selected but deliberately NOT filtered on: the two derivations
  // below need opposite scopes. Sport must survive an archived team (above);
  // the displayed team NAMES must not (`teamNamesByMember`).
  const { data: teamsRaw } = useCollection<Team>('teams', {
    fields: ['id', 'sport', 'name', 'active'],
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
  const nameByTeam = useMemo(
    () => new Map<string, string>(
      teams.map((tm) => [String(tm.id), tm.name ?? ''] as [string, string]),
    ),
    [teams],
  )
  /**
   * The rollover CLONES a team into a new id and archives the old row, and the
   * member's `member_teams` row on the archived team is never deleted — so an
   * unguarded junction read is the union of every season the member ever
   * played. That is what made 68 volleyball members render a strictly larger
   * team set than they hold (a player on D1 showing "D1, D2"; one on D2 showing
   * "D1, D2, DU23-1"). Gate on `teams.active`, never on `member_teams.season`.
   */
  const activeTeamIds = useMemo(
    () => new Set(teams.filter((tm) => tm.active).map((tm) => String(tm.id))),
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
    // `guest_level` is what separates a licensed player from a guest — see
    // `sportsByMember` below for why this page has to know the difference.
    fields: ['id', 'member', 'team', 'guest_level'],
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

  // The VIS federation directory (migration 241). 69 rows and effectively
  // static, so it is fetched whole and cached for an hour rather than filtered
  // down to the ISO codes on screen — a filter would refetch on every tab
  // switch for no gain. Deliberately NOT part of the boot gate below: a missing
  // directory degrades to "no contact on file" per row, and must never hold the
  // transfer worklist hostage.
  const { data: federationsRaw } = useCollection<VisFederation>('vis_federations', {
    fields: ['vis_no', 'iso', 'code', 'name', 'email', 'website'],
    all: true,
    staleTime: 3_600_000,
  })
  const federationByIso = useMemo(() => {
    const map = new Map<string, VisFederation>()
    for (const f of federationsRaw ?? []) {
      const iso = String(f.iso ?? '').trim().toUpperCase()
      if (iso) map.set(iso, f)
    }
    return map
  }, [federationsRaw])

  /**
   * memberId → the sports they play, from their team memberships.
   *
   * ⚠ GUESTS ARE EXCLUDED. A `member_teams` row with `guest_level > 0` is
   * somebody who trains with a team without being licensed by the club — they
   * hold no Swiss Volley / Swiss Basketball licence at all, so there is no
   * eligibility to establish, nothing to look up in VIS and no transfer anyone
   * owes. Leaving them in put people on a worklist that could never be worked.
   * Same rule the scorer assignment already applies to duty eligibility
   * (`buildScorerTeams` in AssignmentAlgorithm.ts).
   *
   * Guest memberships are kept in a SECOND map rather than discarded, so a
   * member dropped for being guest-only can be reported in the header instead of
   * silently vanishing — and so a member who is a full player on one team and a
   * guest on another still counts as a player.
   */
  const { sportsByMember, guestSportsByMember } = useMemo(() => {
    const players = new Map<string, Set<Team['sport']>>()
    const guests = new Map<string, Set<Team['sport']>>()
    for (const j of junction) {
      const memberId = relId(j.member)
      const teamSport = sportByTeam.get(relId(j.team))
      if (!memberId || (teamSport !== 'volleyball' && teamSport !== 'basketball')) continue
      const target = (j.guest_level ?? 0) > 0 ? guests : players
      const set = target.get(memberId)
      if (set) set.add(teamSport)
      else target.set(memberId, new Set([teamSport]))
    }
    return { sportsByMember: players, guestSportsByMember: guests }
  }, [junction, sportByTeam])

  /**
   * memberId → their VOLLEYBALL PLAYER team names, for the member cell. Same
   * guest exclusion as `sportsByMember` (a guest membership is not the row's
   * reason to be on this page), and volleyball-scoped like the page itself: a
   * dual-sport member shows the teams the transfer in front of the admin is
   * about, not their basketball ones.
   *
   * Also the input to the U20 exemption below, which is why the "player, in
   * this sport" filtering lives in one place rather than two.
   *
   * ⚠ CURRENT-season only (`activeTeamIds`) — unlike `sportsByMember` above,
   * which is deliberately all-season. A member with no active volleyball team
   * therefore gets no names, and so is NOT U20-exempt below: the safe default
   * on a transfer worklist is to leave someone on it.
   */
  const teamNamesByMember = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const j of junction) {
      const memberId = relId(j.member)
      const teamId = relId(j.team)
      if (!memberId || (j.guest_level ?? 0) > 0) continue
      if (!activeTeamIds.has(teamId)) continue
      if (sportByTeam.get(teamId) !== SPORT) continue
      const name = nameByTeam.get(teamId)
      if (!name) continue
      const list = map.get(memberId)
      if (list) { if (!list.includes(name)) list.push(name) }
      else map.set(memberId, [name])
    }
    for (const list of map.values()) list.sort((a, b) => a.localeCompare(b, 'de-CH'))
    return map
  }, [junction, sportByTeam, nameByTeam, activeTeamIds])

  /**
   * Members exempt because EVERY volleyball team they play for is a U20 team —
   * see `NO_TRANSFER_VB_TEAM_NAMES`. Built from `teamNamesByMember`, so it
   * inherits the same player-only, volleyball-only scope.
   *
   * A member whose team has no name at all is deliberately NOT exempt: the
   * absence of a name is not evidence of a junior team, and the safe default
   * here is to leave someone ON the worklist.
   */
  const u20OnlyMembers = useMemo(() => {
    const set = new Set<string>()
    for (const [memberId, names] of teamNamesByMember) {
      if (names.length > 0 && names.every((n) => NO_TRANSFER_VB_TEAM_NAMES.has(n.trim()))) {
        set.add(memberId)
      }
    }
    return set
  }, [teamNamesByMember])

  /**
   * A member appears on this page only when a team actually puts them in
   * VOLLEYBALL as a PLAYER (guest memberships do not count — see
   * `sportsByMember`).
   *
   * Members on NO team used to surface so nothing could hide — but a transfer
   * is only owed by someone who plays, and the register carries enough
   * team-less people (ehemalige, passive, parents) that they buried the cohort
   * this page exists for. They are counted and named in the header instead, so
   * dropping them stays visible rather than silent: give them a team and they
   * reappear.
   */
  const playsVolleyball = useCallback(
    (memberId: string) => sportsByMember.get(memberId)?.has(SPORT) ?? false,
    [sportsByMember],
  )

  /**
   * Members who WOULD be on a worklist but are not shown, reported in the
   * header so a filter never silently swallows a real transfer.
   *
   * The three reasons are counted SEPARATELY because they mean different
   * things: "on no team" is a data gap to fix (give them a team and they
   * reappear), "guest only" is the correct answer (no licence, so no transfer),
   * and "basketball" is a whole sport this page does not cover — see `SPORT`.
   *
   * Only the two WORKLIST cohorts count. A settled member never had a row to
   * lose, and the Swiss cohort is a reference list rather than work — counting
   * either would report hundreds of members as "hidden" from a list nobody is
   * expected to act on.
   */
  const hidden = useMemo(() => {
    let noTeam = 0
    let guestOnly = 0
    let basketball = 0
    for (const m of members) {
      const bucket = bucketOf(m)
      if (bucket !== 'needs' && bucket !== 'clarify') continue
      const id = String(m.id)
      if (sportsByMember.get(id)?.has(SPORT)) continue
      // Guest first: a volleyball guest is dropped for the licence reason, not
      // for whatever else they may also play.
      if (guestSportsByMember.get(id)?.has(SPORT)) guestOnly += 1
      else if (sportsByMember.get(id)?.size || guestSportsByMember.get(id)?.size) basketball += 1
      else noTeam += 1
    }
    return { noTeam, guestOnly, basketball }
  }, [members, sportsByMember, guestSportsByMember])

  /**
   * The volleyball cohorts. `u20` is a COUNT, not a list: those members are
   * exempt by the team they play in (`NO_TRANSFER_VB_TEAM_NAMES`), so there is
   * no per-member state to keep and nothing to work — but they are reported in
   * the header, because an exemption that is invisible is indistinguishable
   * from a bug.
   */
  const cohorts = useMemo(() => {
    const acc = {
      needs: [] as TransferMember[],
      clarify: [] as TransferMember[],
      swiss: [] as TransferMember[],
      settled: 0,
      u20: 0,
    }
    for (const m of members) {
      const bucket = bucketOf(m)
      if (bucket === 'ignore') continue
      const id = String(m.id)
      if (!playsVolleyball(id)) continue
      // The exemption only removes WORK. A U20 player with a Swiss or 'NONE'
      // answer keeps their place in the settled tally and the Swiss reference
      // list below — nothing about them changed, they were never work.
      if ((bucket === 'needs' || bucket === 'clarify') && u20OnlyMembers.has(id)) {
        acc.u20 += 1
        continue
      }
      if (bucket === 'needs') acc.needs.push(m)
      else if (bucket === 'clarify') acc.clarify.push(m)
      else if (bucket === 'swiss') acc.swiss.push(m)
      else acc.settled += 1
    }
    return acc
  }, [members, playsVolleyball, u20OnlyMembers])

  // ── Licence validation ────────────────────────────────────────────
  // Swiss Volley validates the licence once the ITC has arrived, reconciled every
  // working day — so for a member who needs an ITC, `licence_validated = true` is
  // the downstream evidence that the transfer completed. There is no readable
  // FIVB transfer API for us (VIS gates transfer request types for guests, and
  // club access is a Swiss Volley UI login), so the Pending/Done toggle stays
  // manual and this is a cross-CHECK, not a replacement.
  const vbNeeds = cohorts.needs
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
    fields: [
      'id', 'association_id', 'email', 'licence_validated', 'licence_validation_date',
      'nationality', 'nationality_code',
    ],
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

  // The two mismatches. Only the first is a hard problem: a transfer recorded as
  // done whose licence is not validated means the ITC has NOT landed and the
  // player is not eligible — fielding an unvalidated licence is sanctionable
  // (FIVB Disciplinary Regulations Art. 11.4).
  const blockedRows = useMemo(
    () => vbNeeds.filter((m) => m.transfer_status === 'done' && validationOf(m) !== 'validated'),
    [vbNeeds, validationOf],
  )
  const probablyDoneRows = useMemo(
    () => vbNeeds.filter((m) => m.transfer_status === 'pending' && validationOf(m) === 'validated'),
    [vbNeeds, validationOf],
  )

  // Federation of origin drives the actionable grouping; nationality drives the
  // "to clarify" grouping, because those members have no federation answer yet.
  const needsGroups = useMemo(
    () => groupRows(
      cohorts.needs,
      (m) => String(m.federation_of_origin ?? '').trim().toUpperCase(),
      (code) => federationDisplay(code, SPORT) || code,
    ),
    [cohorts.needs],
  )
  /**
   * The Swiss cohort under Swiss Volley itself. Always exactly one group (every
   * row answered 'CH'), built through `groupRows` anyway so it renders through
   * the same code path — and so the label comes from the same
   * `federationDisplay` the other groups use ("🇨🇭 Swiss Volley").
   */
  const swissGroups = useMemo(
    () => groupRows(
      cohorts.swiss,
      () => 'CH',
      (code) => federationDisplay(code, SPORT) || code,
    ),
    [cohorts.swiss],
  )
  const clarifyGroups = useMemo(
    () => groupRows(
      cohorts.clarify,
      // The primary (first) nationality. None of these members holds CH — that is
      // what put them in this bucket — so the first code is the meaningful one.
      (m) => parseCountryCodes(m.nationalitaet_codes)[0] ?? '',
      (code) => {
        const flag = countryFlag(code)
        const label = countryLabel(code) || code
        return flag ? `${flag} ${label}` : label
      },
    ),
    [cohorts.clarify],
  )

  // VIS presence across the ACTIONABLE cohort only — the settled and to-clarify
  // members are never checked, so counting them would just inflate "not checked"
  // with rows nobody is expected to act on.
  const visCounts = useMemo(() => {
    let inVis = 0
    let notFound = 0
    let unchecked = 0
    for (const m of cohorts.needs) {
      if (m.in_vis === true) inVis += 1
      else if (m.in_vis === false) notFound += 1
      else unchecked += 1
    }
    return { inVis, notFound, unchecked }
  }, [cohorts.needs])

  /**
   * Newest `in_vis_checked_at` anywhere in the loaded set — i.e. when the VIS
   * columns were last established. Across ALL members, not just the actionable
   * cohort: one run writes every row it evaluated, so the newest timestamp is
   * the run, and reading it off a filtered subset would understate it on a tab
   * where nothing is actionable. Directus returns ISO-8601 UTC, which sorts
   * lexicographically, so a string compare is the right one here.
   */
  const lastVisCheck = useMemo(() => {
    let newest: string | null = null
    for (const m of members) {
      const at = m.in_vis_checked_at
      if (at && (!newest || at > newest)) newest = at
    }
    return newest
  }, [members])

  // ── VIS check on demand ───────────────────────────────────────────
  /**
   * The monthly cron (`/opt/vis-sync/vis-sync.sh`, 1st of the month) used to be
   * the ONLY writer of `in_vis` — so for 30 days of every 31 this page was
   * frozen, and the header's Refresh button (a plain refetch of `members`)
   * could not change that no matter how often it was pressed. This runs the
   * real check.
   *
   * 202 + poll, not a request we hold open: a full pass pulls one whole
   * federation roster per federation of origin in the cohort (VIS ignores name
   * filters), Swiss Volley's being the largest, so it takes minutes — well past
   * what the Cloudflare tunnel will keep alive.
   */
  const [visRunning, setVisRunning] = useState(false)
  // Set on unmount so the poll loop stops touching state after the page is
  // gone. A ref, not state: the loop must read the CURRENT value, and a stale
  // closure over a state variable would keep polling forever.
  const visCancelled = useRef(false)
  useEffect(() => () => { visCancelled.current = true }, [])

  const runVisCheck = useCallback(async () => {
    setVisRunning(true)
    try {
      await kscwApi('/admin/vis-player-check', { method: 'POST' })
      toast.info(t('trVisCheckStarted'))
    } catch (err) {
      const code = (err as { code?: string }).code
      // Another admin (or this same page before a reload) already has a run in
      // flight — follow that one rather than reporting a failure.
      if (code !== 'vis_check_running') {
        setVisRunning(false)
        toast.error(code === 'vis_credentials_missing' ? t('trVisCheckUnavailable') : t('trVisCheckFailed'))
        return
      }
    }

    // Poll to completion. 2s, because a measured run is ~4s (24 federation
    // rosters, ~460 members) — a lazier cadence would spend most of the wait
    // idling after the job had already finished. The deadline mirrors the
    // endpoint's own run timeout plus a minute of slack, so the UI gives up
    // slightly AFTER the server does rather than leaving a spinner that
    // outlives the job.
    const deadline = Date.now() + 16 * 60_000
    for (;;) {
      await new Promise((resolve) => { setTimeout(resolve, 2000) })
      if (visCancelled.current) return
      let status: VisCheckStatus
      try {
        status = await kscwApi<VisCheckStatus>('/admin/vis-player-check')
      } catch {
        setVisRunning(false)
        toast.error(t('trVisCheckFailed'))
        return
      }
      if (visCancelled.current) return
      if (!status.running) {
        setVisRunning(false)
        // Pull the freshly written in_vis / vis_player_no / in_vis_checked_at.
        await refetch()
        if (status.result?.ok) {
          toast.success(t('trVisCheckDone', {
            checked: status.result.checked ?? 0,
            inVis: status.result.inVis ?? 0,
            notFound: status.result.notFound ?? 0,
          }))
        } else {
          toast.error(t('trVisCheckFailed'))
        }
        return
      }
      if (Date.now() > deadline) {
        setVisRunning(false)
        toast.info(t('trVisCheckSlow'))
        return
      }
    }
  }, [refetch, t])

  // ── Writes ────────────────────────────────────────────────────────
  // Note drafts live here (not in the row) so typing never triggers a
  // render-phase state write from a prop — the React #301 pattern. They are
  // intentionally never cleared: after a save the draft already equals the
  // server value, so keeping it avoids a flash of the stale row while the
  // invalidated `members` query refetches.
  const [noteDrafts, setNoteDrafts] = useState<Map<string, string>>(new Map())
  const [savingId, setSavingId] = useState<string | null>(null)

  /**
   * Whether the Swiss Volley group is expanded. Closed on purpose: it is the
   * LARGEST cohort by far (migration 239 seeded ~483 members to CH) and it is a
   * reference list, not work — open by default it would push the handful of
   * actual transfers off the screen. Its header still carries the count and the
   * VIS split, so the summary is readable without expanding anything.
   */
  const [swissOpen, setSwissOpen] = useState(false)

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

  const nothingToDo = cohorts.needs.length === 0 && cohorts.clarify.length === 0

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
    const vm = vmByMember.get(String(m.id))
    const validatedAt = vm?.licence_validation_date
    // Volleymanager's side of the "federation of origin" question. VM stores no
    // FoO at all, so the closest it has is shown verbatim for comparison:
    // citizenship + the licence's playing nationality (see VmRow). Verbatim on
    // purpose — the value is evidence of what VM literally says, and mapping a
    // German country name or an IOC code through our own tables would let a
    // mapping bug misreport the register being checked against.
    const vmNationality = String(vm?.nationality ?? '').trim()
    const vmPlaysAs = String(vm?.nationality_code ?? '').trim()
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
        {(vmNationality || vmPlaysAs) && (
          <span
            className="block text-xs whitespace-normal text-gray-400 dark:text-gray-500"
            title={t('trVmOriginHint')}
          >
            {vmNationality && vmPlaysAs
              ? t('trVmOriginBoth', { nationality: vmNationality, code: vmPlaysAs })
              : t('trVmOrigin', { value: vmNationality || vmPlaysAs })}
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

  /**
   * VIS presence for ONE member: the state, when it was established, and — when
   * they are in VIS — the number to paste into the VIS search.
   *
   * The federation contact and the request letter deliberately do NOT live here.
   * They are identical for every row of a federation group, so per row they were
   * ~120px of repeated boilerplate that pushed the note field off the screen;
   * they now sit once in the group header, which is also the only place a
   * consolidated ask can exist.
   *
   * The three states are worded as evidence, never as verdicts. In particular
   * `false` renders as "not found", never "does not exist": see the `in_vis`
   * doc comment on TransferMember for why a miss usually indicts our seeded
   * federation of origin rather than the federation itself.
   *
   * `swiss` swaps the hints and drops the transfers-app link: for a CH-origin
   * member the index is Swiss Volley's own and no transfer applies either way,
   * so "a transfer can be requested for them" and an "Open in VIS" CTA would
   * both point at something that does not exist for them.
   */
  const visCell = (m: TransferMember, swiss = false) => (
    <div className="min-w-[7rem] space-y-1">
      {m.in_vis === true ? (
        <span
          title={swiss ? t('trSwissInVisYesHint') : t('trInVisYesHint')}
          className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300"
        >
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          {t('trInVisYes')}
        </span>
      ) : m.in_vis === false ? (
        // Amber, not red: this is a lead to follow up, not a violation.
        <span
          title={swiss ? t('trSwissInVisNoHint') : t('trInVisNoHint')}
          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        >
          <HelpCircle className="h-3 w-3" aria-hidden="true" />
          {t('trInVisNo')}
        </span>
      ) : (
        <span className="block text-xs text-gray-400 dark:text-gray-500" title={t('trInVisUnknownHint')}>
          {t('trInVisUnknown')}
        </span>
      )}

      {/* A stale check is worth seeing: the answer only holds as of this date. */}
      {m.in_vis_checked_at && (
        <span className="block text-xs text-gray-400 dark:text-gray-500">
          {t('trInVisCheckedAt', { date: formatDateZurich(m.in_vis_checked_at) })}
        </span>
      )}

      {m.in_vis === true && (
        <div className="flex flex-wrap items-center gap-1">
          {m.vis_player_no != null && (
            <>
              <span
                title={t('trVisPlayerNo')}
                className="font-mono text-xs font-medium text-gray-900 dark:text-white"
              >
                #{m.vis_player_no}
              </span>
              <CopyButton value={String(m.vis_player_no)} title={t('trCopyPlayerNo')} />
            </>
          )}
          {/* `title` carries the "VIS has no per-player URL" explanation that
              used to be a line of text under every single row. */}
          {!swiss && (
            <a
              href={VIS_TRANSFERS_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={t('trOpenInVisHint')}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-brand-300 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 sm:min-h-0 dark:border-brand-700 dark:text-brand-200 dark:hover:bg-brand-900/30"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              {t('trOpenInVis')}
            </a>
          )}
        </div>
      )}
    </div>
  )

  /**
   * The federation strip under a group header: who they are, how to reach them,
   * and the ONE letter that asks them to enter every player of theirs we cannot
   * open a transfer for yet.
   *
   * ⚠ The letter is withheld from the SWISS group, where the contact is
   * Swiss Volley itself: it would ask Swiss Volley to grant a transfer TO Swiss
   * Volley for players it already licensed. The contact stays, because "who do
   * we write to about a Swiss player missing from VIS" is a real question — the
   * answer is just not this letter.
   */
  const federationBar = (g: Group, mode: TableMode) => {
    const iso = g.key
    const fed = federationByIso.get(iso) ?? null
    const emails = splitEmails(fed?.email)
    const name = prettyFederationName(fed?.name)
    // Everyone we cannot request a transfer for yet: not found AND never
    // checked. Both need the same thing from the federation, and splitting them
    // into two letters would ask the same people the same question twice.
    const pending = g.rows.filter((m) => m.in_vis !== true)
    const canRequest = mode === 'needs' && !!fed && pending.length > 0
    const body = canRequest ? visRequestText(pending, name) : ''
    // Prefilling the body is the nice case, but a 16-name letter blows past what
    // Windows will hand to a mail client. Rather than drop the link (the big
    // federations are exactly the ones worth writing to), fall back to a
    // pre-addressed EMPTY message and tell the admin to paste — a truncated
    // letter that looks complete is the only genuinely bad outcome here.
    const subject = encodeURIComponent(VIS_REQUEST_SUBJECT)
    const withBody = emails[0]
      ? `mailto:${emails[0]}?subject=${subject}&body=${encodeURIComponent(body)}`
      : ''
    const mailtoOk = withBody.length > 0 && withBody.length <= MAILTO_MAX
    const mailto = !canRequest || !emails[0]
      ? ''
      : mailtoOk ? withBody : `mailto:${emails[0]}?subject=${subject}`

    return (
      <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-2 dark:border-gray-700 dark:bg-gray-900/20">
        {!fed ? (
          // No directory row for this ISO — say so plainly. An empty mailto:
          // would look like a working contact and silently go nowhere.
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('trVisFederationMissing', { code: iso || '—' })}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{name}</span>
            {emails.length === 0 ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">{t('trVisNoEmail')}</span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1">
                {/* mailto on the FIRST address only — VIS lists several for many
                    federations and which one is right for a transfer is the
                    club's call, so the rest are copied but not pre-picked. */}
                <a
                  href={`mailto:${emails[0]}`}
                  className="text-xs font-medium break-all text-brand-700 hover:underline dark:text-brand-200"
                >
                  {emails[0]}
                </a>
                <CopyButton
                  value={emails.join('; ')}
                  title={emails.length > 1 ? t('trCopyEmails') : t('trCopyEmail')}
                />
                {emails.length > 1 && (
                  <span className="text-xs text-gray-400 dark:text-gray-500" title={emails.slice(1).join('; ')}>
                    {t('trVisMoreAddresses', { count: emails.length - 1 })}
                  </span>
                )}
              </span>
            )}
          </div>
        )}

        {/* Collapsed by default: a 24-name letter open on every group would bury
            the tables it belongs to. Nothing is ever sent from this page. */}
        {canRequest && (
          <details className="mt-1.5">
            <summary className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 text-xs font-medium text-brand-700 sm:min-h-0 dark:text-brand-200">
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('trBulkRequestTitle', { count: pending.length })}
            </summary>
            <p className="mt-1 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs whitespace-pre-line text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
              {body}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <CopyButton value={body} title={t('trRequestCopy')} label={t('trRequestCopy')} />
              {mailto && (
                <a
                  href={mailto}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-brand-300 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 sm:min-h-0 dark:border-brand-700 dark:text-brand-200 dark:hover:bg-brand-900/30"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('trBulkCompose')}
                </a>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {mailtoOk ? t('trRequestHint') : t('trBulkTooLong')}
            </p>
          </details>
        )}
      </div>
    )
  }

  /**
   * One card + data table per group. `mode` decides what a group IS, and
   * everything else follows from it:
   *
   *  - `needs`   — the actionable worklist. Licence validation, VIS presence,
   *                the transfer status toggle, the federation contact and the
   *                one consolidated letter.
   *  - `clarify` — grouped by NATIONALITY, not by a federation answer. No status
   *                (there is no transfer to have one about — the note is where
   *                "asked on …" goes), no VIS (never checked), and no federation
   *                bar: a nationality must not be addressed as though it were a
   *                federation-of-origin answer.
   *  - `swiss`   — Swiss Volley's own players. VIS presence and the Swiss Volley
   *                contact, no status, and COLLAPSED — see `swissOpen`.
   */
  const renderTable = (groups: Group[], mode: TableMode) => {
    const withStatus = mode === 'needs'
    const withVis = mode !== 'clarify'
    const collapsible = mode === 'swiss'
    const headerClass = 'flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5'
    return (
    <div className="space-y-4">
      {groups.map((g) => {
        // Per-federation VIS split, shown in the header so an admin can see
        // which groups still need a letter without opening any of them. Zero
        // buckets are omitted rather than shown as "0" — three pills on every
        // group is noise; the ones that are there all mean something. On the
        // collapsed Swiss group this header is the whole point: the split is
        // readable without expanding 483 rows.
        const inVis = g.rows.filter((m) => m.in_vis === true).length
        const notFound = g.rows.filter((m) => m.in_vis === false).length
        const unchecked = g.rows.length - inVis - notFound
        const header = (
          <>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {g.label || t('trUnknownFederation')}
            </span>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {t('trMemberCount', { count: g.rows.length })}
            </span>
            {withVis && (
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                {inVis > 0 && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    {inVis} {t('trInVisYes')}
                  </span>
                )}
                {notFound > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {notFound} {t('trInVisNo')}
                  </span>
                )}
                {unchecked > 0 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                    {unchecked} {t('trInVisUnknown')}
                  </span>
                )}
              </span>
            )}
          </>
        )
        const body = (
          <>
            {/* Federation contact, and for `needs` the consolidated letter. */}
            {withVis && federationBar(g, mode)}
            <div className="border-t border-gray-100 dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('trColMember')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('trColNationality')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('trColLicence')}</TableHead>
                  {withStatus && <TableHead>{t('trColLicenceValidated')}</TableHead>}
                  {withVis && <TableHead>{t('trColInVis')}</TableHead>}
                  {withStatus && <TableHead>{t('trColStatus')}</TableHead>}
                  <TableHead>{t('trColNote')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.rows.map((m) => {
                  const id = String(m.id)
                  return (
                    <TableRow key={id}>
                      <TableCell className="min-h-[44px] align-top">
                        <NameCell m={m} teamNames={teamNamesByMember.get(id)} />
                      </TableCell>
                      <TableCell className="hidden align-top text-xs text-gray-600 sm:table-cell dark:text-gray-300">
                        <span aria-hidden="true" className="mr-1">
                          {parseCountryCodes(m.nationalitaet_codes).map(countryFlag).join(' ')}
                        </span>
                        {formatCountryCodes(m.nationalitaet_codes)}
                      </TableCell>
                      {/* Licence number + category in one column. They are two
                          facets of the same fact and each alone was a near-empty
                          column; the birthdate moved into the member cell, where
                          it belongs with the rest of the identity. */}
                      <TableCell className="hidden align-top text-xs whitespace-normal text-gray-600 md:table-cell dark:text-gray-300">
                        <span className="block font-mono" title={t('trColLicenceNr')}>
                          {m.license_nr || '—'}
                        </span>
                        {m.licence_category && (
                          <span className="block text-gray-400 dark:text-gray-500" title={t('trColCategory')}>
                            {m.licence_category}
                          </span>
                        )}
                      </TableCell>
                      {withStatus && (
                        <TableCell className="align-top">{licenceCell(m)}</TableCell>
                      )}
                      {withVis && (
                        <TableCell className="align-top">{visCell(m, mode === 'swiss')}</TableCell>
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
          </>
        )
        return (
        <div
          key={g.key || 'unknown'}
          className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/50"
        >
          {collapsible ? (
            // `open` is CONTROLLED so the body can stay unmounted while closed:
            // the Swiss group is hundreds of rows, each with a text input, and a
            // native <details> only HIDES its content — it still mounts it, which
            // would make every page load pay for a table nobody opened.
            <details className="group" open={swissOpen} onToggle={(e) => setSwissOpen(e.currentTarget.open)}>
              <summary
                className={`${headerClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
              >
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
                {header}
              </summary>
              {swissOpen && body}
            </details>
          ) : (
            <>
              <div className={headerClass}>{header}</div>
              {body}
            </>
          )}
        </div>
        )
      })}
    </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('trTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('trDescription')}</p>
          {/* Say what the filters drop. A worklist that quietly omits people is
              worse than one that is a little longer. */}
          {hidden.noTeam > 0 && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('trHiddenNoTeam', { count: hidden.noTeam })}
            </p>
          )}
          {/* Guests are dropped for a REASON, not by an accident of filtering —
              so this line explains rather than apologises. */}
          {hidden.guestOnly > 0 && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('trHiddenGuests', { count: hidden.guestOnly })}
            </p>
          )}
          {/* Basketball has no tab here any more (see `SPORT`) — so say how many
              members that costs, rather than letting a whole sport vanish. */}
          {hidden.basketball > 0 && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('trHiddenBasketball', { count: hidden.basketball })}
            </p>
          )}
          {/* The U20 exemption, stated where the numbers are read. */}
          {cohorts.u20 > 0 && (
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('trHiddenU20', { count: cohorts.u20 })}
            </p>
          )}
        </div>
        {/* Two buttons that are NOT the same thing, and the labels have to say
            so: Refresh re-reads what the database already holds, "Check VIS
            now" goes and asks FIVB. Before the second one existed, an admin
            pressing the first and seeing a month-old date could only conclude
            it was broken. */}
        <div className="flex flex-wrap items-center gap-2">
          {canRunVisCheck && (
            <button
              onClick={() => { void runVisCheck() }}
              disabled={visRunning}
              aria-busy={visRunning}
              title={t('trVisCheckHint')}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"
            >
              <RadioTower className={`h-3.5 w-3.5 ${visRunning ? 'animate-pulse' : ''}`} aria-hidden="true" />
              {visRunning ? t('trVisCheckRunning') : t('trVisCheckNow')}
            </button>
          )}
          <button
            onClick={() => { void refetch() }}
            disabled={isFetching}
            aria-busy={isFetching}
            title={t('trRefreshHint')}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('trRefresh')}
          </button>
        </div>
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

      {/* ONE context panel instead of the three stacked boxes this page used to
          open with. Top line: the numbers (how many transfers can be REQUESTED
          today vs. are blocked on getting the player into VIS, and the derived
          "needs nothing" tally). Below: the caveats those numbers need to be
          read correctly — each of which is a one-way implication that an admin
          will otherwise get backwards. */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/30">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {cohorts.needs.length > 0 && (
            <>
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                {t('trVisSummaryTitle')}
              </span>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                {visCounts.inVis} {t('trInVisYes')}
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {visCounts.notFound} {t('trInVisNo')}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                {visCounts.unchecked} {t('trInVisUnknown')}
              </span>
            </>
          )}
          {/* Derived "no transfer needed" tally. A count only — these members
              have no independent state to toggle; their federation answer
              already IS the answer.
              ⚠ Deliberately the TOTAL of both settled cohorts (Swiss + 'NONE'),
              not just the ones without a section of their own: the claim is
              "these many members need no transfer", and dropping the Swiss ones
              because they are also listed below would make it false. */}
          <span
            title={t('trSettledDescription')}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300"
          >
            <ShieldCheck className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
            {t('trSettledCount', { count: cohorts.settled + cohorts.swiss.length })}
          </span>
        </div>

        <div className="mt-1.5 space-y-1 text-xs text-gray-500 dark:text-gray-400">
          {/* Dating the VIS numbers where they are read. Without it the pills
              above look live, and the whole page silently asserts a month-old
              answer as today's. */}
          <p>
            {lastVisCheck
              ? t('trVisLastChecked', { date: formatDateTimeCompact(lastVisCheck) })
              : t('trVisNeverChecked')}
          </p>
          <p>{t('trSettledDescription')}</p>
          {/* The "false is not proof" caveat, stated where it is always visible
              — a per-row `title` alone is unreachable on a phone. */}
          {cohorts.needs.length > 0 && <p>{t('trVisSummaryHint')}</p>}
          {/* The licence signal is a ONE-WAY implication and the wording has to
              say so, or an admin reads "not validated" as "the transfer failed". */}
          <p>{t('trLicenceHint')}</p>
        </div>
      </div>

      {/* The empty state replaces the two WORKLIST cohorts only — the Swiss
          reference list below is not work and stays reachable even on a day when
          there is nothing to do. */}
      <div className="space-y-8">
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
          <>
          {/* Cohort A — actionable transfers */}
          {cohorts.needs.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                <Clock className="h-4 w-4 text-amber-500" aria-hidden="true" />
                {t('trNeedsTitle')}
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  {cohorts.needs.length}
                </span>
              </h2>
              <p className="mt-1 mb-3 text-sm text-gray-500 dark:text-gray-400">
                {t('trNeedsDescription')}
              </p>
              {renderTable(needsGroups, 'needs')}
            </section>
          )}

          {/* Cohort B — never asked. Deliberately its own section with its own
              wording: this is a question to put to the member, not a transfer
              that is already running. */}
          {cohorts.clarify.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                <HelpCircle className="h-4 w-4 text-blue-500" aria-hidden="true" />
                {t('trClarifyTitle')}
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {cohorts.clarify.length}
                </span>
              </h2>
              <p className="mt-1 mb-3 text-sm text-gray-500 dark:text-gray-400">
                {t('trClarifyDescription')}
              </p>
              {renderTable(clarifyGroups, 'clarify')}
            </section>
          )}
          </>
        )}

        {/* Cohort C — Swiss Volley's own players. No transfer status: a Swiss
            age-14 licence means no INTERNATIONAL transfer exists to track. */}
        {cohorts.swiss.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <ShieldCheck className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
              {t('trSwissTitle')}
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {cohorts.swiss.length}
              </span>
            </h2>
            <p className="mt-1 mb-3 text-sm text-gray-500 dark:text-gray-400">
              {t('trSwissDescription')}
            </p>
            {renderTable(swissGroups, 'swiss')}
          </section>
        )}
      </div>
    </div>
  )
}
