// src/modules/admin/components/ExplorerMemberFields.tsx
//
// Full-fields view of a single member record for the Data Explorer.
//
// Everything about how a column renders — its group, its label, its help text,
// which control edits it, whether it is read-only and WHY — comes from
// `memberFieldSchema.ts`. This file used to guess all of that from the *value*
// at render time (`detectKind`), which meant a NULL boolean rendered as a text
// box, a NULL jsonb rendered as a text box that then wrote a string into a
// jsonb column, and a long secret rendered as a textarea containing the
// member's private key. A column's type is a property of the column, not of the
// row you happen to be looking at.
//
// Three rules this file exists to hold:
//   • The taxonomy is authoritative. The only value-sniffing left is the narrow
//     fallback for a column that exists in Postgres but not yet in the schema —
//     and that one is quarantined into a visible "Unmapped columns" group so it
//     reads as a maintenance signal instead of being silently mislabelled.
//   • Sport hiding is VISUAL ONLY. A hidden field stays in `draft`, stays in
//     `dirtyKeys`, and is still PATCHed. `dirtyKeys` is computed from the record
//     keys and never from the render plan, so visibility cannot reach it.
//   • Sensitive columns never reach the DOM. `sanitizeRecord` replaces their
//     value with the boolean "was it set" BEFORE it lands in React state, so
//     there is nothing to leak into a screenshot, a devtools dump or a PATCH.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Pencil, Save, X, Loader2, Eye, EyeOff, AlertTriangle, Crosshair } from 'lucide-react'
import { assetUrl, createRecord, deleteRecord, fetchItem, kscwApi, updateRecord } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { getCurrentSeason, todayLocal } from '../../../utils/dateHelpers'
import {
  NO_FEDERATION, countryLabel, countryOptions, formatCountryCodes,
  parseCountryCodes, serializeCountryCodes,
} from '../../../utils/countries'
import CountryMultiSelect from '../../../components/CountryMultiSelect'
import {
  TRAINER_LICENCE_CODES, TRAINER_LICENCE_CODES_BY_SPORT, TRAINER_LICENCE_I18N_KEYS,
  parseTrainerLicences, serializeTrainerLicences, type TrainerLicence,
} from '../../../utils/trainerLicences'
import { coercePositions, getPositionI18nKey, getSelectablePositions } from '../../../utils/memberPositions'
import { useConfirm } from '../../../components/ConfirmProvider'
import type { Team } from '../../../types'
import type { CacheShape } from './explorerHelpers'
import { teamLabel } from './explorerHelpers'
import { TEAM_LINK_KIND_LIST, teamLinkKind } from './teamLinks'
import {
  FEE_AMOUNT_VIRTUAL_KEY, GOVERNED_BY, MEMBER_FIELD_BY_KEY, NEVER_PATCH_KEYS, TEAMS_VIRTUAL_KEY,
  buildMemberFieldSections, fieldFilterReason, getFieldDef, isFieldReadOnly, sanitizeRecord,
  type MemberFieldDef, type MemberFieldKind, type MemberFieldSection,
} from './memberFieldSchema'
import { memberFieldLabel } from './memberFieldSearch'
import { resolveMemberSport, sportCovers, type MemberSport } from './memberSport'
import {
  MEMBER_MULTI_FIELDS, MEMBER_SELECT_FIELDS, MEMBER_SUGGEST_FIELDS,
  isDepartedRegisterStatus, optionLabel,
  type FieldOption,
} from './memberFieldOptions'
import MemberDangerZone from './MemberDangerZone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import SearchableSelect from '@/components/ui/SearchableSelect'
import DatePicker from '@/components/ui/DatePicker'
import DateTimePicker from '@/components/ui/DateTimePicker'
import EmailInput from '@/components/ui/EmailInput'
import PhoneInput from '@/components/ui/PhoneInput'
import AhvInput from '@/components/ui/AhvInput'
import IbanInput from '@/components/ui/IbanInput'
import PostalCodeInput from '@/components/ui/PostalCodeInput'
import PhotoPicker from '@/components/ui/PhotoPicker'
import { TeamPickerMulti, TeamPickerSingle, type TeamPickerOption } from '@/components/ui/TeamPicker'

interface Props {
  memberId: string
  /** For sport resolution and the team pickers. */
  cache: CacheShape
  canEdit: boolean
  /** Role-level delete gate. Narrowed here by the member's own sport (§4.5). */
  canDelete: boolean
  /** The viewer's own sport scope — 'both' for a global admin / dual sport admin. */
  adminScope: MemberSport
  /** Unlocks the `privileged` fields (role, is_spielplaner). */
  isGlobalAdmin: boolean
  /** The viewer's own member id — they may never delete themselves. */
  viewerMemberId?: string | null
  /** Bumped by the page when the cache reloads — re-fetches the record. */
  reloadKey?: number
  /** Junction writes from the teams multiselect update the shared cache. */
  onMutate: (fn: (prev: CacheShape) => CacheShape) => void
  /** Called after a successful field save so the parent can refresh its cache. */
  onSaved?: () => void
  /** Called after a successful hard delete. */
  onDeleted?: () => void
  /** Reports the unsaved-change count up so the page can guard navigation. */
  onDirtyChange?: (count: number) => void
  /**
   * Datapoint focus from the header picker — `members` column keys. Non-empty
   * narrows the render plan to exactly those cards.
   */
  focusFields?: string[]
  /** Drops the focus from the banner this component renders. */
  onClearFocus?: () => void
  /**
   * The detail view's relations / sections tables. They render BETWEEN the
   * field groups and the danger zone, so the danger zone is genuinely the last
   * block of the page (spec §4.1) while the record state it mutates still lives
   * in one component. Passing them as children beats duplicating the record
   * fetch in the parent just to place one section.
   */
  children?: React.ReactNode
}

/** Honest one-word type marker per kind — the chip on every field card. */
/**
 * Sentence case, not lowercase-plus-`uppercase`. These used to be lowercase
 * strings shouted into "TEXT" / "BOOLEAN" by a CSS class; both halves of that
 * broke CLAUDE.md's capitalisation rule, and neither survived a copy-paste out
 * of the page. The three acronyms stay in capitals because that is how they are
 * spelled, which is the rule's one exemption.
 */
const KIND_BADGE: Record<MemberFieldKind, string> = {
  text: 'Text',
  longtext: 'Text',
  number: 'Number',
  bool: 'Boolean',
  date: 'Date',
  datetime: 'Datetime',
  json: 'JSON',
  select: 'Select',
  multiselect: 'Multi',
  // Free text with suggestions — the badge stays honest about the column type.
  suggest: 'Text',
  email: 'Email',
  phone: 'Phone',
  ahv: 'AHV',
  iban: 'IBAN',
  postalcode: 'Text',
  photo: 'Photo',
  team: 'Team',
  teamMulti: 'Teams',
  countryMulti: 'Country',
  country: 'Country',
  positions: 'Multi',
  trainerLicences: 'Multi',
  readonlyMasked: 'Secret',
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}

/**
 * Fresh server record + whatever the operator has typed and not saved yet.
 *
 * An unsaved edit is a key whose PREVIOUS draft value differed from the
 * PREVIOUS record value — the same definition `dirtyKeys` uses, minus the keys
 * that can never be patched. Everything else takes the server's value, so a
 * refresh still picks up changes made elsewhere. Keys are only carried over
 * when the previous state belongs to the SAME member; after a navigation there
 * is nothing to preserve.
 */
function mergeUnsavedEdits(
  fresh: Record<string, unknown>,
  live: { memberId: string; record: Record<string, unknown> | null; draft: Record<string, unknown> },
  memberId: string,
  isGlobalAdmin: boolean,
): Record<string, unknown> {
  const merged = { ...fresh }
  if (live.memberId !== memberId || !live.record) return merged
  for (const key of Object.keys(live.draft)) {
    const def = getFieldDef(key)
    if (def.virtual || NEVER_PATCH_KEYS.has(key)) continue
    if (isFieldReadOnly(def, { isGlobalAdmin })) continue
    if (!valueEquals(live.record[key], live.draft[key])) merged[key] = live.draft[key]
  }
  return merged
}

/** A `fields: ['*']` fetch returns a bare id, but an expanded M2O arrives as an
 *  object. Normalise both to the id string so the pickers never get an object. */
function relId(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id
    return id == null ? null : String(id)
  }
  return String(value)
}

const NO_SPORTS_REVEALED: ReadonlySet<'volleyball' | 'basketball'> = new Set()
/** Used only under a datapoint focus — see the `sections` memo. */
const BOTH_SPORTS_REVEALED: ReadonlySet<'volleyball' | 'basketball'> =
  new Set<'volleyball' | 'basketball'>(['volleyball', 'basketball'])

/**
 * `GET /kscw/finance/members/:id/fee` — the server's itemised Beitrag.
 *
 * `derived` is what the fee RULES alone produce (the placeholder each override
 * field shows); the member's own overrides are what the card adds on top. Both
 * are null when the category has no base at all — an unknown category is never
 * given a guessed amount, here or in the dues run.
 */
interface MemberFeeParts {
  base: number
  surcharge: number
  guest_discount: number
  amount: number
}
interface MemberFee {
  category: string | null
  is_guest: boolean
  base_source: 'schedule' | 'category_map' | null
  fiscal_year: { id: number; label: string } | null
  /** What the surcharge boolean is worth in CHF. Served, never hardcoded here. */
  surcharge_amount: number
  /** Federation licence contained IN the base (migration 323) — how the invoice
   *  itemises it. ⚠ Inside the base, never on top: adding it double-counts. */
  licence: number
  sektion: string | null
  derived: MemberFeeParts | null
  effective: (MemberFeeParts & { discount: number }) | null
}

/** A CHF cell: null/'' → null, so a blank override is "derive it", not zero. */
function chfOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const chf = (n: number) =>
  `CHF ${n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * The live total, recomputed from what is currently in the draft.
 *
 * ⚠ This is arithmetic, NOT a second fee engine. Every decision — which base
 * applies, whether the surcharge is owed, whether the member is a guest — was
 * made server-side by feeBreakdown() and arrives in `fee.derived`. All that
 * happens here is "the operator typed 0 into the surcharge box, so show the sum
 * with 0 in it" instead of waiting for a save + round-trip to find out.
 * The discount cap mirrors withDiscount(): a discount may take a bill to
 * exactly zero, never below.
 */
function liveFee(fee: MemberFee | null, draft: Record<string, unknown>) {
  if (!fee?.derived) return null
  const round2 = (n: number) => Math.round(n * 100) / 100
  const base = chfOrNull(draft.fee_base_override) ?? fee.derived.base
  // Nullable boolean since migration 300: on/off/derive. `=== true|false` on
  // purpose — undefined must not read as "waive".
  const surchargeFlag = draft.fee_surcharge_override
  const surcharge = surchargeFlag === true ? fee.surcharge_amount
    : surchargeFlag === false ? 0
    : fee.derived.surcharge
  const guestDiscount = fee.derived.guest_discount
  const owed = Math.max(0, round2(base + surcharge - guestDiscount))
  // CHF or percent, never both — the DB CHECK enforces it, and CHF wins here so
  // a row that somehow holds both still renders a number rather than NaN.
  const pct = chfOrNull(draft.fee_discount_pct)
  const flat = chfOrNull(draft.fee_discount)
  const wanted = flat !== null && flat > 0 ? round2(flat)
    : pct !== null && pct > 0 ? round2(owed * Math.min(pct, 100) / 100)
    : 0
  const discount = Math.min(Math.max(0, wanted), owed)
  // The federation's share of the base, shown beside it rather than added to it.
  // Zeroed the moment the operator pins a base override — same rule the dues run
  // applies, because nobody recorded what a hand-typed amount is made of — and
  // for a guest, who holds no licence at all.
  const licence = chfOrNull(draft.fee_base_override) !== null || guestDiscount > 0
    ? 0 : Math.min(fee.licence ?? 0, base)
  return {
    base,
    licence,
    surcharge,
    guestDiscount,
    discount,
    discountPct: flat !== null && flat > 0 ? null : (pct !== null && pct > 0 ? pct : null),
    amount: round2(owed - discount),
    baseOverridden: chfOrNull(draft.fee_base_override) !== null,
    surchargeOverridden: surchargeFlag === true || surchargeFlag === false,
  }
}

type LiveFee = ReturnType<typeof liveFee>

const LS_HIDE_EMPTY = 'kscw-explorer-hide-empty'
const LS_SHOW_TECHNICAL = 'kscw-explorer-show-technical'

/** localStorage is unavailable in private mode / with storage blocked — the
 *  preference is cosmetic, so a failure falls back to the default silently. */
function readNoisePref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === '1'
  } catch { return fallback }
}

function writeNoisePref(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* cosmetic */ }
}

/**
 * Target roles that put a member out of reach of anyone below a full admin.
 * ⚠ Mirrors PRIVILEGED_TARGET_ROLES in kscw-endpoints/src/delete-impact.js —
 * change both.
 */
const PRIVILEGED_TARGET_ROLES: ReadonlySet<string> = new Set([
  'admin', 'superuser', 'vorstand', 'vb_admin', 'bb_admin', 'finance',
])

/** `members.role` is a jsonb string array, but a legacy row can hold a bare string. */
function parseRoleList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        return Array.isArray(parsed) ? parsed.map(String) : []
      } catch { return [] }
    }
    return s ? [s] : []
  }
  return []
}

export default function ExplorerMemberFields({
  memberId,
  cache,
  canEdit,
  canDelete,
  adminScope,
  isGlobalAdmin,
  viewerMemberId,
  reloadKey,
  onMutate,
  onSaved,
  onDeleted,
  onDirtyChange,
  focusFields,
  onClearFocus,
  children,
}: Props) {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()

  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [present, setPresent] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [revealedSports, setRevealedSports] =
    useState<ReadonlySet<'volleyball' | 'basketball'>>(NO_SPORTS_REVEALED)
  // Composite `${linkKey}:${teamId}` tokens: the same team can have a write in
  // flight as a coaching link while its roster chip sits idle, and one flat set
  // of team ids would spin both.
  const [busyLinks, setBusyLinks] = useState<ReadonlySet<string>>(() => new Set())
  const [fee, setFee] = useState<MemberFee | null>(null)
  // Noise filters. Sticky across members AND across sessions — an admin who
  // wants the audit stamps back should not have to re-reveal them on every row.
  const [hideEmpty, setHideEmpty] = useState(() => readNoisePref(LS_HIDE_EMPTY, true))
  const [showTechnical, setShowTechnical] = useState(() => readNoisePref(LS_SHOW_TECHNICAL, false))

  // Switching members resets the view state AND re-arms the loading gate.
  // Render-phase adjustment rather than an effect: React's documented "reset
  // state when a prop changes" pattern. Doing it here rather than inside
  // `load()` is also what keeps the fetch effect free of a synchronous
  // setState (react-hooks/set-state-in-effect is an error in this repo).
  const [primedId, setPrimedId] = useState(memberId)
  if (primedId !== memberId) {
    setPrimedId(memberId)
    setRecord(null)
    setError(null)
    setLoading(true)
    setEditMode(false)
    setRevealedSports(NO_SPORTS_REVEALED)
    setBusyLinks(new Set())
    // Otherwise the previous member's Beitrag shows on this one until the fee
    // fetch lands — a wrong number is worse than a pending one.
    setFee(null)
  }

  /**
   * Live mirror of what is on screen, for `load()` to diff against after its
   * await. A ref, not a dependency: `load` must not be re-created (and the fetch
   * effect must not re-fire) on every keystroke in the editor.
   */
  const liveRef = useRef<{
    memberId: string
    record: Record<string, unknown> | null
    draft: Record<string, unknown>
  }>({ memberId, record: null, draft: {} })
  useEffect(() => {
    liveRef.current = { memberId, record, draft }
  }, [memberId, record, draft])

  /** Monotonic request id — only the newest response is allowed to land. */
  const loadSeq = useRef(0)

  // No state is written before the first `await`: a `reloadKey` bump is a
  // background refresh and must not blank a record that is already on screen.
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const item = await fetchItem<Record<string, unknown>>('members', memberId, { fields: ['*'] })
      // A slower response for a member the operator has already navigated away
      // from must not overwrite the one now on screen.
      if (seq !== loadSeq.current) return
      // Strip the four bearer/key-material columns before anything reaches
      // React state — they must never exist in the DOM or in a PATCH payload.
      const safe = sanitizeRecord(item)
      setRecord(safe.record)
      setPresent(safe.present)
      // ⚠ NOT `{ ...safe.record }`. Any cache refresh bumps `reloadKey` and
      // re-runs this — the header Refresh button, and every danger-zone toggle
      // via onSaved — so a blind reset silently threw away whatever the
      // operator had typed but not saved, with no prompt and the dirty count
      // dropping to 0 behind the unsaved-change guard. The fresh server row
      // wins for everything untouched; the operator's unsaved edits are
      // re-applied on top.
      setDraft(mergeUnsavedEdits(safe.record, liveRef.current, memberId, isGlobalAdmin))
      setError(null)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [memberId, isGlobalAdmin])

  // The rule flags any setState reachable from an effect, even the ones that
  // only run after the `await` (verified: both the try/catch/finally and the
  // bare-await shapes are rejected). Fetch-then-store is exactly what an effect
  // is for, and the reset above already keeps the render path stable — so this
  // is the repo's usual scoped exemption, not a cascading-render bug.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load, reloadKey])

  /**
   * The itemised Beitrag. Its own fetch rather than part of `load()`: it is one
   * read-only card, it needs the finance endpoint rather than the items API, and
   * a 403 there (a sport admin, who has no business seeing club finances) must
   * not take the whole member record down with it.
   */
  const feeSeq = useRef(0)
  const loadFee = useCallback(async () => {
    const seq = ++feeSeq.current
    try {
      const data = await kscwApi<MemberFee>(`/finance/members/${memberId}/fee`)
      if (seq === feeSeq.current) setFee(data)
    } catch {
      // 403 (not finance / not board) or 404 — the card says "not available"
      // and every other field on the page keeps working.
      if (seq === feeSeq.current) setFee(null)
    }
  }, [memberId])

  // Same scoped exemption as `load` above: fetch-then-store is what an effect is
  // for, and the reset in the render path keeps this from cascading.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadFee() }, [loadFee, reloadKey])

  // ── Derived ──────────────────────────────────────────────────────────

  const keys = useMemo(() => (record ? Object.keys(record) : []), [record])

  /**
   * ⚠ Computed from the RECORD, never from the render plan — this is what makes
   * "hiding is visual only" true. A dirty value in a collapsed sport block is
   * still counted here and still ends up in the PATCH.
   */
  const dirtyKeys = useMemo(() => {
    if (!record) return [] as string[]
    return keys.filter((k) => {
      const def = getFieldDef(k)
      if (def.virtual || NEVER_PATCH_KEYS.has(k)) return false
      if (isFieldReadOnly(def, { isGlobalAdmin })) return false
      return !valueEquals(record[k], draft[k])
    })
  }, [record, draft, keys, isGlobalAdmin])

  // Report unsaved changes up so ExplorePage can confirm before navigating away
  // (otherwise clicking another member in the tree discards them silently).
  useEffect(() => {
    onDirtyChange?.(dirtyKeys.length)
    return () => onDirtyChange?.(0)
  }, [dirtyKeys.length, onDirtyChange])

  const sport: MemberSport = useMemo(
    () => resolveMemberSport(
      {
        id: memberId,
        sektion: record?.sektion,
        beitragskategorie: record?.beitragskategorie,
      },
      cache,
    ),
    [memberId, record, cache],
  )

  // Columns Postgres has but the schema does not. Quarantined out of the normal
  // render plan and shown in their own group — an unmapped column is a bug to
  // fix, not something to bury in "System & audit".
  const unmappedKeys = useMemo(
    () => keys.filter((k) => !MEMBER_FIELD_BY_KEY[k]).sort((a, b) => a.localeCompare(b)),
    [keys],
  )

  const dirtySet = useMemo(() => new Set(dirtyKeys), [dirtyKeys])

  // Declared above the noise filters: these are what make the three virtual
  // team cards empty or not.
  const linkIdsByKey = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const kind of TEAM_LINK_KIND_LIST) out[kind.key] = kind.idsOf(cache, memberId)
    return out
  }, [cache, memberId])

  /**
   * "Holds no value", for the hide-empty filter. Reads `draft` rather than
   * `record` so a field somebody just filled in cannot vanish from under them.
   *
   * ⚠ Sensitive columns never hold their value in memory — sanitizeRecord()
   * replaced it with the boolean "was it set" and recorded that in `present`,
   * which is therefore the only truth about them. Testing `draft` instead would
   * read a masked-but-set key as `false` — not empty by the rule below, so it
   * would leak "this member HAS an ical token" into the default view.
   */
  const isEmptyKey = useCallback((key: string): boolean => {
    if (key in linkIdsByKey) return linkIdsByKey[key].length === 0
    // The Beitrag card holds no column value, so the generic rule below would
    // read it as empty and the hide-empty filter — on by default — would hide
    // the one card in the group that answers "what does this member pay".
    // Empty means genuinely unanswerable: no fee endpoint, or no rate for the
    // category.
    if (key === FEE_AMOUNT_VIRTUAL_KEY) return !fee?.derived
    if (key in present) return !present[key]
    const value = key in draft ? draft[key] : record?.[key]
    // Same rule the value renderer uses: `false` and `0` are values, not blanks.
    return value == null || value === '' || (Array.isArray(value) && value.length === 0)
  }, [present, draft, record, linkIdsByKey, fee])

  // Hiding empties in edit mode would make an empty field unfillable, so the
  // filter is view-only. The toggle keeps its state — leaving edit mode brings
  // the tidy view straight back.
  const hideEmptyNow = hideEmpty && !(editMode && canEdit)

  /**
   * Datapoint focus. Non-empty narrows the page to those cards alone.
   *
   * ⚠ A focus deliberately OVERRIDES all three hiding rules — hide-empty,
   * show-technical and the sport gate. Asking for "AHV number" and getting a
   * blank page because this member has none is the bug this feature exists to
   * fix; the same goes for a basketball licence on a volleyball member. The
   * point of the focus is to answer "what does this field hold", and "nothing"
   * is an answer that has to be visible (and, in edit mode, fillable).
   */
  const focusSet = useMemo(() => new Set(focusFields ?? []), [focusFields])
  const focusing = focusSet.size > 0

  const sections: MemberFieldSection[] = useMemo(() => {
    if (!record) return []
    const mapped = keys.filter((k) => MEMBER_FIELD_BY_KEY[k])
    const all = [...mapped, TEAMS_VIRTUAL_KEY, FEE_AMOUNT_VIRTUAL_KEY]
    return buildMemberFieldSections({
      // `dirtySet` rides along so changing the focus mid-edit cannot hide a
      // pending change — the same rule the two noise filters already follow
      // via `alwaysShow`, which applies too late to help here (this list is
      // what buildMemberFieldSections is even allowed to consider).
      presentKeys: focusing ? all.filter((k) => focusSet.has(k) || dirtySet.has(k)) : all,
      sport,
      revealedSports: focusing ? BOTH_SPORTS_REVEALED : revealedSports,
      hideEmpty: focusing ? false : hideEmptyNow,
      isEmpty: isEmptyKey,
      showTechnical: focusing ? true : showTechnical,
      alwaysShow: dirtySet,
    })
  }, [record, keys, sport, revealedSports, hideEmptyNow, isEmptyKey, showTechnical, dirtySet, focusing, focusSet])

  /**
   * Focused datapoints that produced no card — the column is not on the record
   * at all, which for a non-admin means a policy withheld it. Naming them beats
   * a silently short page.
   */
  const focusMissing = useMemo(() => {
    if (!focusing || !record) return [] as string[]
    const rendered = new Set(sections.flatMap((s) => s.entries.flatMap((e) => e.fields.map((f) => f.key))))
    return [...focusSet].filter((k) => !rendered.has(k))
  }, [focusing, record, sections, focusSet])

  /**
   * What the two toggles would reveal, for their labels. Counted with the SAME
   * predicate the render plan uses (both filters forced on), over the same
   * population minus the blocks already hidden by sport — otherwise "Show
   * technical (21)" reveals 20 cards for a basketball member and reads as a bug.
   */
  const hiddenCounts = useMemo(() => {
    let empty = 0
    let technical = 0
    if (!record) return { empty, technical }
    const mapped = keys.filter((k) => MEMBER_FIELD_BY_KEY[k])
    for (const key of [...mapped, TEAMS_VIRTUAL_KEY, FEE_AMOUNT_VIRTUAL_KEY]) {
      const def = getFieldDef(key)
      const gate = def.sportGate
      if (gate && !sportCovers(sport, gate) && !revealedSports.has(gate)) continue
      const reason = fieldFilterReason(def, {
        showTechnical: false,
        hideEmpty: true,
        isEmpty: isEmptyKey,
        alwaysShow: dirtySet,
      })
      if (reason === 'technical') technical++
      else if (reason === 'empty') empty++
    }
    return { empty, technical }
  }, [record, keys, sport, revealedSports, isEmptyKey, dirtySet])

  /** Cards actually on screen, for the "23 / 100 fields" chip in the header. */
  const visibleFieldCount = useMemo(
    () => sections.reduce((n, s) => n + s.visibleCount, 0),
    [sections],
  )

  const toggleHideEmpty = useCallback(() => {
    setHideEmpty((prev) => { writeNoisePref(LS_HIDE_EMPTY, !prev); return !prev })
  }, [])

  const toggleShowTechnical = useCallback(() => {
    setShowTechnical((prev) => { writeNoisePref(LS_SHOW_TECHNICAL, !prev); return !prev })
  }, [])

  const memberName = useMemo(() => {
    if (!record) return `#${memberId}`
    const name = [record.first_name, record.last_name].filter(Boolean).join(' ').trim()
    return name || String(record.email || `#${memberId}`)
  }, [record, memberId])

  const teamOptions: TeamPickerOption[] = useMemo(() => {
    const toOption = (tm: Team): TeamPickerOption => ({
      id: String(tm.id),
      // ⚠ The sport comes from `teams.sport`, never from the name: 'Herren 2 H3'
      // and 'Damen D-Classics 1LR' are basketball teams.
      label: teamLabel(tm),
      sport: tm.sport === 'volleyball' || tm.sport === 'basketball' ? tm.sport : null,
      season: tm.season ?? null,
      active: tm.active ?? undefined,
    })
    const options = cache.teams.map(toOption)
    // The member's OWN roster rows can point at a team the scoped, active-only
    // list does not carry (a closed season, or the other sport). Those are
    // added so the chip reads as the team it is instead of a bare "#412", and
    // so the same row can be unticked from the dropdown. Nothing else widens
    // the picker — an inactive team the member is NOT on stays out of it.
    const known = new Set(options.map((o) => o.id))
    for (const ids of Object.values(linkIdsByKey)) {
      for (const id of ids) {
        if (known.has(id)) continue
        const tm = cache.teamLookup.get(id)
        if (!tm) continue
        known.add(id)
        options.push(toOption(tm))
      }
    }
    return options
  }, [cache.teams, cache.teamLookup, linkIdsByKey])

  // Sport scope for the delete affordance. Resolved off the FULL record (which
  // carries sektion + beitragskategorie), so it is strictly better informed than
  // the cache-only resolution the caller could do. The server re-checks anyway.
  const withinSportScope =
    adminScope === 'both' || sport === 'both' || sport === adminScope
  // Rank + self, mirroring the two checks POST /kscw/admin/delete-member makes
  // (the server is the boundary; this only keeps the button off the screen).
  // Deleting a member takes their login with it, so a sport admin doing it to a
  // board member or another admin would be an account takedown of someone who
  // outranks them — and nobody deletes their own record.
  const targetIsPrivileged = useMemo(
    () => parseRoleList(record?.role).some((r) => PRIVILEGED_TARGET_ROLES.has(r)),
    [record],
  )
  const isSelf = viewerMemberId != null && String(viewerMemberId) === memberId
  const canDeleteMember =
    canDelete && withinSportScope && !isSelf && (isGlobalAdmin || !targetIsPrivileged)

  // ── Write paths ──────────────────────────────────────────────────────

  /**
   * Draft write, plus the one field pair that moves together.
   *
   * Membership status and exit date are not independent: the register cannot
   * express "left the club" without saying when, and it cannot express "still a
   * member, left on 3 March" at all (migration 302 enforces that with a CHECK,
   * so a mismatched pair is a 400 rather than a bad row). Rather than let an
   * admin discover that at save time, picking a departed status fills today's
   * date and picking an active one clears it.
   *
   * Both moves are visible in the draft and both are overridable before saving —
   * the prefill is a default, not a decision. An exit date that is ALREADY set
   * is never overwritten: it is usually the real, known leaving date and today
   * is only a guess.
   */
  const setField = useCallback((key: string, value: unknown) => {
    setDraft((d) => {
      const next = { ...d, [key]: value }
      if (key === 'register_status') {
        if (isDepartedRegisterStatus(value)) {
          if (!next.austritt) next.austritt = todayLocal()
        } else {
          // Includes clearing the status back to "—": an exit date with no
          // departed status is exactly what the CHECK constraint rejects.
          next.austritt = null
        }
      }
      return next
    })
  }, [])

  const handleCancel = useCallback(async () => {
    if (dirtyKeys.length > 0) {
      const ok = await confirm({
        title: t('explorerFieldsDiscardTitle'),
        message: t('explorerFieldsDiscardMessage', { count: dirtyKeys.length }),
        danger: true,
      })
      if (!ok) return
    }
    if (record) setDraft({ ...record })
    setEditMode(false)
  }, [dirtyKeys.length, confirm, t, record])

  const handleSave = useCallback(async () => {
    if (!record || dirtyKeys.length === 0) {
      setEditMode(false)
      return
    }
    const patch: Record<string, unknown> = {}
    for (const k of dirtyKeys) patch[k] = draft[k]

    // ── Departing the club is more than one column ──────────────────────────
    // A status of 'Ehemaliges Mitglied' / 'Kein Mitglied' / 'Verstorben' is the
    // statement that this person is no longer one of ours, and leaving them on
    // rosters, in mailing audiences, in the dues run and able to log in
    // contradicts it. So the two active flags come along — but only ever
    // downward, only with a confirm, and only when they are still on.
    //
    // ⚠ These two are danger-zone fields: read-only in the grid, edited in
    // MemberDangerZone, and therefore never in `dirtyKeys`. Writing them here is
    // a deliberate exception to that "one column, one editing surface" rule,
    // which is why it is gated behind a confirm that names both of them rather
    // than riding along silently.
    const nextStatus = patch.register_status
    if ('register_status' in patch && isDepartedRegisterStatus(nextStatus)) {
      const stillActive = record.kscw_membership_active === true || record.wiedisync_active === true
      if (stillActive) {
        const ok = await confirm({
          title: t('explorerStatusDepartedTitle'),
          message: t('explorerStatusDepartedMessage', { name: memberName, status: String(nextStatus) }),
          danger: true,
        })
        if (!ok) return
        patch.kscw_membership_active = false
        patch.wiedisync_active = false
      }
    }

    // The CHECK constraint's own rule, enforced here so it reads as a sentence
    // instead of as a Postgres violation. Only reachable by editing the date on
    // a member whose status is already active — every status change through
    // setField keeps the pair consistent on its own.
    const effectiveStatus = 'register_status' in patch ? patch.register_status : record.register_status
    const effectiveAustritt = 'austritt' in patch ? patch.austritt : record.austritt
    if (effectiveAustritt && !isDepartedRegisterStatus(effectiveStatus)) {
      toast.error(t('explorerStatusAustrittNeedsDeparted'))
      return
    }

    // A discount is a decision somebody made, and the invoice prints its reason
    // as the credit line — an unnamed one shows the member a bare "Rabatt" and
    // leaves the audit trail with no answer to "why is this person paying less?".
    // Judged on the EFFECTIVE values, not the patch: editing only the amount on a
    // row whose reason was already blank must still be caught.
    const effDiscount = 'fee_discount' in patch ? patch.fee_discount : record.fee_discount
    const effDiscountPct = 'fee_discount_pct' in patch ? patch.fee_discount_pct : record.fee_discount_pct
    const effReason = 'fee_discount_reason' in patch ? patch.fee_discount_reason : record.fee_discount_reason
    if ((Number(effDiscount) > 0 || Number(effDiscountPct) > 0) && !String(effReason ?? '').trim()) {
      toast.error(t('explorerFeeDiscountNeedsReason'))
      return
    }

    setSaving(true)
    try {
      // `fields: ['*']` — without it Directus answers with its default field set
      // and the record would silently change shape (and lose columns) on save.
      const updated = await updateRecord<Record<string, unknown>>(
        'members', memberId, patch, { fields: ['*'] },
      )
      logActivity('update', 'members', memberId, patch)
      const safe = sanitizeRecord(updated)
      setRecord(safe.record)
      setPresent(safe.present)
      setDraft({ ...safe.record })
      setEditMode(false)
      toast.success(t('explorerMemberFieldsSaved', { count: Object.keys(patch).length }))
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [record, dirtyKeys, draft, memberId, t, onSaved, confirm, memberName])

  /**
   * Team links — player roster, coaching, team responsible.
   *
   * All three write their junction rows IMMEDIATELY, outside the field form's
   * save: a junction row is not a column on this record, so it has no place in
   * `dirtyKeys` or in the PATCH body, and pretending otherwise is how the same
   * link ends up written twice.
   *
   * ⚠ Which collection and which column names each one uses lives in
   * `teamLinks.ts`, not here. `member_teams` is keyed `member` / `team` and
   * carries a season; the two staff junctions were generated by the Directus
   * M2M wizard and are keyed `members_id` / `teams_id`. Reading one through the
   * other's names silently writes an orphan row.
   *
   * ⚠ Coaching a team must NOT create a roster row — a coach in `member_teams`
   * shows up in the squad, in RSVP counts, in the scorer duty pool and in the
   * ClubDesk player group as though they played. That is why these are three
   * fields and not one field with a role picker.
   */
  const handleLinkChange = useCallback(async (linkKey: string, nextIds: string[]) => {
    const kind = teamLinkKind(linkKey)
    if (!kind) return
    const currentIds = kind.idsOf(cache, memberId)
    const nextSet = new Set(nextIds)
    const currentSet = new Set(currentIds)
    const added = nextIds.filter((id) => !currentSet.has(id))
    const removed = currentIds.filter((id) => !nextSet.has(id))
    const relation = t(`admin:${kind.labelKey}`)

    // teamLookup, not cache.teams: a removal confirm for a past-season team
    // must name the team, not print its id at the operator.
    const labelOf = (teamId: string) => {
      const team = cache.teams.find((tm) => String(tm.id) === teamId)
        ?? cache.teamLookup.get(teamId)
      return team ? teamLabel(team) : teamId
    }
    const markBusy = (teamId: string, busy: boolean) =>
      setBusyLinks((prev) => {
        const next = new Set(prev)
        const token = `${linkKey}:${teamId}`
        if (busy) next.add(token)
        else next.delete(token)
        return next
      })

    for (const teamId of removed) {
      const row = kind.rowsOf(cache, memberId).find((r) => r.team === teamId)
      if (!row) continue
      const teamName = labelOf(teamId)
      const ok = await confirm({
        message: t('admin:explorerFieldsLinkRemoveConfirm', { name: memberName, team: teamName, relation }),
        danger: true,
      })
      if (!ok) continue
      markBusy(teamId, true)
      try {
        await deleteRecord(kind.collection, row.id)
        logActivity('delete', kind.collection, row.id, { member: memberId, team: teamId })
        onMutate((prev) => kind.applyRemove(prev, row.id))
        toast.success(t('admin:explorerFieldsTeamsRemoved', { team: teamName }))
      } catch {
        toast.error(t('admin:explorerFieldsTeamsError'))
      } finally {
        markBusy(teamId, false)
      }
    }

    for (const teamId of added) {
      const teamName = labelOf(teamId)
      markBusy(teamId, true)
      try {
        // The TARGET TEAM's own season, not the wall clock — see teamLinks.ts.
        // teamLookup is included so a team missing from cache.teams still stamps
        // its real season rather than today's. Ignored by the staff junctions.
        const season =
          (cache.teams.find((tm) => String(tm.id) === teamId) ?? cache.teamLookup.get(teamId))?.season
          ?? getCurrentSeason()
        const created = await createRecord<{ id: string | number; guest_level?: number | null; season?: string | null }>(
          kind.collection,
          kind.createPayload(memberId, teamId, season),
        )
        const rowId = String(created.id)
        logActivity('create', kind.collection, rowId, { member: memberId, team: teamId })
        onMutate((prev) => kind.applyAdd(prev, {
          id: rowId,
          member: memberId,
          team: teamId,
          season: created.season ?? season,
          guestLevel: created.guest_level ?? 0,
        }))
        toast.success(t('admin:explorerFieldsTeamsAdded', { team: teamName }))
      } catch {
        toast.error(t('admin:explorerFieldsTeamsError'))
      } finally {
        markBusy(teamId, false)
      }
    }
  }, [cache, memberId, memberName, confirm, t, onMutate])

  const toggleSport = useCallback((gate: 'volleyball' | 'basketball') => {
    setRevealedSports((prev) => {
      const next = new Set(prev)
      if (next.has(gate)) next.delete(gate)
      else next.add(gate)
      return next
    })
  }, [])

  const handleStatusPatched = useCallback(
    (patch: Record<string, unknown>, updated: Record<string, unknown>) => {
      const safe = sanitizeRecord(updated)
      setRecord(safe.record)
      setPresent(safe.present)
      // Keep the operator's in-flight edits; only the danger-zone keys change.
      // `onSaved` refreshes the page cache, which re-runs load() — that path
      // preserves unsaved edits too (mergeUnsavedEdits), so this is no longer
      // undone two ticks later.
      setDraft((d) => ({ ...d, ...patch }))
      onSaved?.()
    },
    [onSaved],
  )

  /**
   * The record is gone. Drop the unsaved-change count FIRST — otherwise the
   * parent's navigation guard asks the operator whether to discard edits to a
   * member that no longer exists, and answering No strands them on a dead id.
   */
  const handleDeleted = useCallback(() => {
    if (record) setDraft({ ...record })
    onDirtyChange?.(0)
    onDeleted?.()
  }, [record, onDirtyChange, onDeleted])

  /**
   * One entry per team relation, handed to the editor by virtual key. Built
   * here rather than inside FieldEditor so the three cards cannot end up
   * sharing a list — see FieldEditorCtx.teamLinks.
   */
  const teamLinks = useMemo(() => {
    const out: Record<string, TeamLinkState> = {}
    for (const kind of TEAM_LINK_KIND_LIST) {
      const prefix = `${kind.key}:`
      out[kind.key] = {
        ids: linkIdsByKey[kind.key] ?? [],
        busy: new Set(
          [...busyLinks].filter((token) => token.startsWith(prefix)).map((token) => token.slice(prefix.length)),
        ),
        onChange: (ids: string[]) => handleLinkChange(kind.key, ids),
      }
    }
    return out
  }, [linkIdsByKey, busyLinks, handleLinkChange])

  // ── Render ───────────────────────────────────────────────────────────

  // The relations tables below do not depend on this fetch, so they still
  // render while the record is loading or if it failed.
  if (loading && !record) {
    return (
      <>
        <div className="mb-4 flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('explorerMemberFieldsLoading')}
        </div>
        {children}
      </>
    )
  }

  if (error || !record) {
    return (
      <>
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error ?? t('explorerMemberFieldsError')}
        </div>
        {children}
      </>
    )
  }

  const editing = editMode && canEdit
  const editorCtx: EditorCtx = {
    sport,
    teamOptions,
    teamLinks,
    disabled: saving,
    fee,
    // Recomputed on every draft change so the total tracks what is being typed
    // into the three override boxes, not what was last saved.
    liveFee: liveFee(fee, draft),
    isEmpty: isEmptyKey,
  }

  return (
    <>
    <section className="mb-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">
          {t('explorerMemberFieldsTitle')}
          <span className="ml-2 font-normal text-muted-foreground/70">
            {visibleFieldCount} / {keys.length} {t('explorerMemberFieldsCount')}
          </span>
        </h2>
        {/* The filters belong to everybody who can SEE the record, not only to
            those who can edit it — a read-only viewer looks at the same 100
            cards. They fold away in edit mode, where the empty filter is off
            anyway and the technical fields are all read-only. */}
        {/* Under a focus the two noise toggles are inert (the focus overrides
            both), so they are replaced by the Edit button alone. */}
        {!editing && focusing && canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {t('explorerMemberFieldsEdit')}
          </Button>
        )}
        {!editing && !focusing && (
          <div className="flex flex-wrap items-center gap-2">
            <NoiseToggle
              on={!hideEmptyNow}
              label={hideEmptyNow
                ? t('explorerFieldsShowEmpty', { count: hiddenCounts.empty })
                : t('explorerFieldsHideEmpty')}
              onClick={toggleHideEmpty}
              suppressed={hideEmptyNow && hiddenCounts.empty === 0}
            />
            <NoiseToggle
              on={showTechnical}
              label={showTechnical
                ? t('explorerFieldsHideTechnical')
                : t('explorerFieldsShowTechnical', { count: hiddenCounts.technical })}
              onClick={toggleShowTechnical}
              suppressed={!showTechnical && hiddenCounts.technical === 0}
            />
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t('explorerMemberFieldsEdit')}
              </Button>
            )}
          </div>
        )}
        {canEdit && editMode && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {dirtyKeys.length === 0
                ? t('explorerMemberFieldsNoChanges')
                : t('explorerMemberFieldsChanges', { count: dirtyKeys.length })}
            </span>
            <Button size="sm" variant="ghost" onClick={() => { void handleCancel() }} disabled={saving}>
              <X className="mr-1 h-3.5 w-3.5" />
              {t('cancel')}
            </Button>
            <Button size="sm" onClick={() => { void handleSave() }} disabled={saving || dirtyKeys.length === 0}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              {t('save')}
            </Button>
          </div>
        )}
      </header>

      {focusing && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <Crosshair className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-xs font-medium text-primary">
            {t('explorerDatapointFocused', { count: focusSet.size })}
          </span>
          <span className="flex flex-wrap gap-1">
            {[...focusSet].map((key) => (
              <span key={key} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                {memberFieldLabel(key)}
              </span>
            ))}
          </span>
          {focusMissing.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {t('explorerDatapointUnavailable', {
                fields: focusMissing.map(memberFieldLabel).join(', '),
              })}
            </span>
          )}
          {onClearFocus && (
            <button
              type="button"
              onClick={onClearFocus}
              className="ml-auto inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <X className="h-3.5 w-3.5" />
              {t('explorerDatapointShowAll')}
            </button>
          )}
        </div>
      )}

      <div className="space-y-6">
        {sections.map((section) => {
          // A toggle per gate the member is NOT in — it stays after revealing so
          // the block can be collapsed again.
          const gates = section.entries
            .map((e) => e.subsection?.sportGate ?? null)
            .filter((g): g is 'volleyball' | 'basketball' => !!g && !sportCovers(sport, g))

          return (
            <section key={section.group.id}>
              <header className="mb-2 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-1.5">
                <div className="min-w-0">
                  <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                    {section.group.label}
                    <span className="ml-2 font-normal text-muted-foreground/60">
                      {section.visibleCount}
                    </span>
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground/80">{section.group.description}</p>
                </div>
                {gates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {gates.map((gate) => {
                      const revealed = revealedSports.has(gate)
                      const key = revealed
                        ? (gate === 'volleyball' ? 'explorerFieldsHideVolleyball' : 'explorerFieldsHideBasketball')
                        : (gate === 'volleyball' ? 'explorerFieldsShowVolleyball' : 'explorerFieldsShowBasketball')
                      return (
                        <button
                          key={gate}
                          type="button"
                          onClick={() => toggleSport(gate)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          {t(key)}
                        </button>
                      )
                    })}
                  </div>
                )}
              </header>

              {section.entries.map((entry) => {
                const subId = entry.subsection?.id ?? '_'
                if (entry.hiddenBySport) {
                  return (
                    <div key={subId} className="mb-3">
                      {entry.subsection?.label && (
                        <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground/70">
                          {entry.subsection.label}
                        </h4>
                      )}
                      <p className="mt-0.5 text-xs italic text-muted-foreground/70">
                        {t('explorerFieldsHiddenBySport')}
                      </p>
                    </div>
                  )
                }
                return (
                  <div key={subId} className="mb-3">
                    {entry.subsection?.label && (
                      <h4 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground/70">
                        {entry.subsection.label}
                      </h4>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {entry.fields.map((def) => (
                        <FieldCard
                          key={def.key}
                          def={def}
                          record={record}
                          draft={draft}
                          present={present}
                          editing={editing}
                          isGlobalAdmin={isGlobalAdmin}
                          ctx={editorCtx}
                          onChange={setField}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </section>
          )
        })}

        {/* Columns Postgres has that the taxonomy does not know about yet. Kept
            visible and read-only: mislabelling one is worse than flagging it. */}
        {unmappedKeys.length > 0 && !focusing && (
          <section>
            <header className="mb-2 border-b border-amber-500/40 pb-1.5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('explorerFieldsUnmappedColumn')}
                <span className="font-normal text-muted-foreground/60">
                  {unmappedKeys.length}
                </span>
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                Present in the database but not described in memberFieldSchema.ts. Add them there.
              </p>
            </header>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {unmappedKeys.map((key) => (
                <FieldCard
                  key={key}
                  def={getFieldDef(key)}
                  record={record}
                  draft={draft}
                  present={present}
                  editing={editing}
                  isGlobalAdmin={isGlobalAdmin}
                  ctx={editorCtx}
                  onChange={setField}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </section>

    {/* Relations / sections tables sit between the fields and the danger zone. */}
    {children}

    <MemberDangerZone
      memberId={memberId}
      member={record}
      canEditStatus={canEdit}
      canDelete={canDeleteMember}
      onPatched={handleStatusPatched}
      onDeleted={handleDeleted}
    />
    </>
  )
}

// ── Field card ─────────────────────────────────────────────────────────

/**
 * Everything `FieldEditor` itself needs — deliberately narrower than the
 * `EditorCtx` the field CARDS need.
 *
 * The bulk-edit modal renders the very same controls for a set of members, where
 * there is no one record to have a fee, an emptiness or a roster: giving the
 * editor its own context is what lets it be reused there without inventing a
 * fake member. A `teamLinks` entry then means "the teams being composed"
 * rather than "the teams this member is on", which is the only shape
 * difference between the two callers.
 */
export interface TeamLinkState {
  /** Team ids currently linked (or, in bulk edit, being composed). */
  ids: string[]
  /** Ids with a write in flight — the picker greys and spins those chips. */
  busy: ReadonlySet<string>
  onChange: (ids: string[]) => void | Promise<void>
}

export interface FieldEditorCtx {
  sport: MemberSport
  teamOptions: TeamPickerOption[]
  /**
   * Virtual key → the relation that key edits. Keyed rather than a single
   * `rosterTeamIds`, because there are three of them (player / coach / team
   * responsible) and a shared one would make ticking a team as coach also tick
   * it as a roster place — which is the exact confusion these fields exist to
   * end. See `teamLinks.ts`.
   */
  teamLinks: Readonly<Record<string, TeamLinkState>>
  disabled: boolean
}

interface EditorCtx extends FieldEditorCtx {
  /** Server-side fee context — null when the endpoint is unavailable (403/404). */
  fee: MemberFee | null
  /** The same figures with the unsaved override edits applied. */
  liveFee: LiveFee
  /** "Holds no value" — the same rule the hide-empty filter uses. */
  isEmpty: (key: string) => boolean
}

/**
 * One noise filter, styled like the existing per-sport reveal buttons so the two
 * read as the same mechanism.
 *
 * `suppressed` hides the button when the filter is ON but has nothing to hide —
 * offering "Show empty fields (0)" on a fully filled member is noise of exactly
 * the kind this is here to remove. It never hides a button that would turn a
 * filter back ON, so a revealed set is always re-hideable.
 */
function NoiseToggle({
  on,
  label,
  onClick,
  suppressed,
}: {
  on: boolean
  label: string
  onClick: () => void
  suppressed: boolean
}) {
  if (suppressed) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      {on ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}

/** The two discount units, each pointing at the one it locks out. */
const DISCOUNT_TWIN: Record<string, string> = {
  fee_discount: 'fee_discount_pct',
  fee_discount_pct: 'fee_discount',
}
/** "Carries a value" for a numeric override: 0 is a real, deliberate entry —
 *  only null/undefined/'' mean the operator left the field alone. */
const hasFilledValue = (v: unknown) => v !== null && v !== undefined && v !== ''

function FieldCard({
  def,
  record,
  draft,
  present,
  editing,
  isGlobalAdmin,
  ctx,
  onChange,
}: {
  def: MemberFieldDef
  record: Record<string, unknown>
  draft: Record<string, unknown>
  present: Record<string, boolean>
  editing: boolean
  isGlobalAdmin: boolean
  ctx: EditorCtx
  onChange: (key: string, value: unknown) => void
}) {
  const { t } = useTranslation('admin')
  const readOnly = isFieldReadOnly(def, { isGlobalAdmin })
  const original = record[def.key]
  const current = draft[def.key]
  const isDirty = !readOnly && !def.virtual && !valueEquals(original, current)
  // ── The two discount units are mutually exclusive ───────────────────────────
  // `members_fee_discount_one_unit` refuses a row holding both, and feeBreakdown
  // would have to pick one anyway. So filling either greys the other out, and it
  // stays greyed until both are empty — switching units is "clear the one you
  // have, then fill the other", which is a deliberate act rather than a silent
  // overwrite the CHECK would reject on save.
  const twinKey = DISCOUNT_TWIN[def.key]
  const lockedByTwin = !!twinKey && hasFilledValue(draft[twinKey])
  // The reason is not optional once money comes off — it is the credit line the
  // member reads on their invoice. Flagged on the field itself as well as at
  // save time, so it is answerable where it is asked.
  const reasonMissing = def.key === 'fee_discount_reason'
    && (Number(draft.fee_discount) > 0 || Number(draft.fee_discount_pct) > 0)
    && !String(draft.fee_discount_reason ?? '').trim()
  // A `privileged` field locked for a sport admin says so plainly rather than
  // reusing the generic "read-only" wording.
  const lockedByPrivilege = !!def.privileged && !isGlobalAdmin
  // A privacy switch whose subject column is blank — see GOVERNED_BY.
  const governedKey = GOVERNED_BY[def.key]
  const governsEmpty = !!governedKey && ctx.isEmpty(governedKey)

  return (
    <article
      className={
        'flex flex-col gap-1.5 rounded-lg border p-3 transition-colors '
        + (isDirty
          ? 'border-primary/60 bg-primary/5'
          : 'border-border bg-card hover:border-border/80')
        + (def.wide ? ' sm:col-span-2' : '')
      }
    >
      <header className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground" title={def.key}>
          {def.label}
        </h4>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {readOnly && (
            <span
              className="rounded bg-muted px-1.5 py-0.5 text-[9px] tracking-wide text-muted-foreground"
              title={def.provenance}
            >
              {lockedByPrivilege
                ? t('explorerFieldsPrivilegedLocked')
                : t('explorerMemberFieldsReadonly')}
            </span>
          )}
          {def.overwrittenBy && (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
              title={def.overwrittenBy}
            >
              {t('explorerFieldsOverwritten')}
            </span>
          )}
          {isDirty && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] tracking-wide text-primary">
              {t('explorerMemberFieldsDirty')}
            </span>
          )}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] tracking-wide text-muted-foreground">
            {KIND_BADGE[def.kind]}
          </span>
        </div>
      </header>

      <div className="text-sm">
        {!editing || readOnly ? (
          <DisplayValue def={def} value={original} present={present} ctx={ctx} />
        ) : (
          <FieldEditor
            def={def}
            value={current}
            ctx={lockedByTwin ? { ...ctx, disabled: true } : ctx}
            onChange={(v) => onChange(def.key, v)}
          />
        )}
      </div>

      {editing && lockedByTwin && (
        <p className="text-xs text-muted-foreground">
          {t('explorerFeeDiscountOneUnit', { field: memberFieldLabel(twinKey) })}
        </p>
      )}

      {editing && reasonMissing && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {t('explorerFeeDiscountNeedsReasonField')}
        </p>
      )}

      {governsEmpty && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {t('explorerFieldsGovernsEmpty', { field: memberFieldLabel(governedKey) })}
        </p>
      )}

      {def.help && <p className="text-xs text-muted-foreground">{def.help}</p>}

      {/* "Why can't I edit this, and who wrote the value" — answered in the
          product, not in a wiki. Visible on read-only fields, where there is
          room for it and where the question actually gets asked. */}
      {readOnly && def.provenance && (
        <p className="text-xs italic text-muted-foreground/80">{def.provenance}</p>
      )}

      {/* The amber warning only matters while you are about to type into it. */}
      {editing && !readOnly && def.overwrittenBy && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{def.overwrittenBy}</p>
      )}
    </article>
  )
}

// ── Display ────────────────────────────────────────────────────────────

/**
 * "There is no value in this column."
 *
 * ⚠ Was a muted em-dash, which reads as decoration rather than as a fact — an
 * empty `birthdate` sitting under a `Birthdate visibility: Hidden` card looked
 * like a date the app was declining to show. Red and worded, in the same weight
 * the `false` branch of a boolean already uses, so "nothing is stored" and
 * "something is stored but withheld" can never be confused again.
 */
function EmptyValue() {
  const { t } = useTranslation('admin')
  return (
    <span className="font-medium text-red-600 dark:text-red-400">
      {t('explorerFieldsEmpty')}
    </span>
  )
}

/**
 * The itemised Beitrag: the total first, because that is the question being
 * asked, with the parts under it so "why 310 and not 210?" is answered on the
 * card instead of in a mail to the treasurer.
 *
 * A part the operator overrode is labelled as such — a base of 210 somebody
 * typed and a base of 210 the rate table produced are not the same fact, and
 * only one of them follows the category if it changes.
 *
 * English, like every other label in this view (see memberFieldOptions.ts): the
 * Data Explorer is an admin tool with one vocabulary, and the amounts are CHF
 * in Swiss formatting regardless of the operator's UI language.
 */
function FeeBreakdownValue({ fee, live }: { fee: MemberFee | null; live: LiveFee }) {
  if (!fee) {
    return <span className="text-muted-foreground">Not available</span>
  }
  if (!fee.derived || !live) {
    return (
      <span className="text-muted-foreground">
        {fee.category ? 'No rate for this fee category' : 'No fee category set'}
      </span>
    )
  }

  // The base splits into the club's own fee and the federation licence inside it
  // (migration 323). Two lines summing to the base, never a third amount — and
  // only when there is a licence to name, so a basketball or overridden row keeps
  // reading as a single "Base".
  const federation = live.licence > 0
    ? ({ Volleyball: 'Swiss Volley licence', Basketball: 'Swiss Basketball licence' } as Record<string, string>)[fee.sektion ?? ''] ?? 'Federation licence'
    : null
  const parts: { label: string; value: number; negative?: boolean }[] = federation
    ? [
        { label: 'Membership', value: Math.round((live.base - live.licence) * 100) / 100 },
        { label: federation, value: live.licence },
      ]
    : [{ label: live.baseOverridden ? 'Base (overridden)' : 'Base', value: live.base }]
  if (live.surcharge > 0 || live.surchargeOverridden) {
    // ⚠ NOT a licence fee — it is the surcharge for NOT holding a scorer licence,
    // and next to a real "Swiss Volley licence" line the old wording read as a
    // second licence the member was being charged for.
    parts.push({
      label: live.surchargeOverridden ? 'No scorer licence (overridden)' : 'No scorer licence',
      value: live.surcharge,
    })
  }
  if (live.guestDiscount > 0) parts.push({ label: 'Guest', value: live.guestDiscount, negative: true })
  if (live.discount > 0) {
    parts.push({
      // A percentage discount says so: "40.00" alone hides that it will move
      // with the base next season.
      label: live.discountPct !== null ? `Discount (${live.discountPct}%)` : 'Discount',
      value: live.discount,
      negative: true,
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-base font-semibold text-foreground">{chf(live.amount)}</span>
      <dl className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {parts.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between gap-3">
            <dt>{p.negative ? `− ${p.label}` : p.label}</dt>
            <dd className="tabular-nums">{p.negative ? '−' : ''}{p.value.toFixed(2)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-muted-foreground/80">
        {fee.base_source === 'schedule'
          ? `Season rate${fee.fiscal_year ? ` ${fee.fiscal_year.label}` : ''}`
          : 'Category map — no season rate set'}
        {fee.is_guest ? ' · guest' : ''}
      </p>
    </div>
  )
}

function DisplayValue({
  def,
  value,
  present,
  ctx,
}: {
  def: MemberFieldDef
  value: unknown
  present: Record<string, boolean>
  ctx: EditorCtx
}) {
  const { t } = useTranslation('admin')

  // Secrets: the value was replaced with a boolean before it reached state, so
  // there is literally nothing here to print.
  if (def.kind === 'readonlyMasked' || def.sensitive) {
    const isSet = present[def.key] === true
    return (
      <span
        className={
          'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium '
          // Same red as EmptyValue: an unset secret is an empty column too, and
          // a grey chip made it the one blank on the page that did not look
          // like one.
          + (isSet
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300')
        }
        title={t('explorerFieldsSensitiveHidden')}
      >
        {isSet ? t('explorerFieldsSensitiveSet') : t('explorerFieldsSensitiveNotSet')}
      </span>
    )
  }

  // The Beitrag is computed, not stored: it reads from the fee context rather
  // than from `value`, which for a virtual key is always undefined.
  if (def.key === FEE_AMOUNT_VIRTUAL_KEY) {
    return <FeeBreakdownValue fee={ctx.fee} live={ctx.liveFee} />
  }

  // Roster membership lives in the junction table, not in a column, so it reads
  // from the cache rather than from `value`.
  //
  // ⚠ A `teams` row is PER SEASON — 'H2' 2025/26 and 'H2' 2026/27 are two
  // different teams with the same name — so a member who stayed on the same
  // team rendered the identical chip twice and read as duplicated data (or as a
  // team-responsible link leaking into the roster). Past-season chips therefore
  // carry their season and are dimmed; the current season stays bare, which is
  // the ordinary case. The picker already labelled its rows this way.
  if (def.kind === 'teamMulti') {
    const linkIds = ctx.teamLinks[def.key]?.ids ?? []
    if (linkIds.length === 0) return <EmptyValue />
    const thisSeason = getCurrentSeason()
    return (
      <span className="flex flex-wrap gap-1.5">
        {linkIds.map((id) => {
          const team = ctx.teamOptions.find((o) => o.id === id)
          // "Past season" is decided by the TEAM being archived, not by
          // comparing its season to the clock: `getCurrentSeason()` is ahead of
          // every live team's season for all of May and behind it between the
          // Jun-1 cutover and the rollover, and in that window EVERY chip dimmed
          // and read "Past season". `active` is flipped by the rollover itself,
          // so it cannot disagree. The season string is still what gets shown.
          const isPast = team?.active === false || (!!team?.season && team.season !== thisSeason && team?.active === undefined)
          const pastSeason = isPast ? (team?.season ?? null) : null
          return (
            <span
              key={id}
              className={
                'inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs text-foreground'
                + (pastSeason ? ' opacity-60' : '')
              }
              title={pastSeason ? `Past season ${pastSeason}` : undefined}
            >
              {team?.sport && (
                <span className="text-[9px] font-semibold text-muted-foreground">
                  {team.sport === 'volleyball' ? 'VB' : 'BB'}
                </span>
              )}
              {team?.label ?? `#${id}`}
              {pastSeason && (
                <span className="text-[9px] tabular-nums text-muted-foreground">{pastSeason}</span>
              )}
            </span>
          )
        })}
      </span>
    )
  }

  // A select whose NULL *means* something — the surcharge tri-state, where empty
  // is "follow the licence" — says so instead of rendering the generic "—" for
  // "nobody filled this in".
  if (def.kind === 'select' && value == null) {
    const noneLabel = MEMBER_SELECT_FIELDS[def.key]?.noneLabel
    if (noneLabel) return <span className="text-muted-foreground">{noneLabel}</span>
  }

  // `false` must read "No" and `0` must read "0" — only null / '' / [] are empty.
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return <EmptyValue />
  }

  switch (def.kind) {
    case 'bool':
      return (
        <span
          className={
            value
              ? 'font-medium text-emerald-600 dark:text-emerald-400'
              : 'font-medium text-red-600 dark:text-red-400'
          }
        >
          {value ? 'Yes' : 'No'}
        </span>
      )

    case 'countryMulti':
      // Stored order is meaningful: the first code is the primary and is the
      // one pushed to ClubDesk.
      return <span className="break-words text-foreground">{formatCountryCodes(String(value))}</span>

    case 'country':
      // Two different shapes share this kind: `federation_of_origin` holds an
      // ISO-2 code (or the explicit 'NONE'), while the derived `nationalitaet`
      // holds ClubDesk's German country NAME.
      //
      // ⚠ `nationalitaet` is printed RAW. Running it through localizeCountryName
      // reverse-maps "Schweiz" → CH → the viewer's locale, so the one field whose
      // job is to show the exact string the sync-up writes into the register
      // rendered "Switzerland" in an English session — hiding the only thing it
      // exists to reveal. The German round-trip is why it read as correct.
      return def.key === 'federation_of_origin'
        ? <FederationValue value={String(value)} />
        : <span className="break-words text-foreground">{String(value)}</span>

    case 'trainerLicences':
      return <TrainerLicencesValue value={String(value)} />

    case 'positions':
      return <PositionValue value={value} />

    case 'multiselect': {
      const opts = MEMBER_MULTI_FIELDS[def.key]
      const codes = Array.isArray(value) ? (value as unknown[]).map(String) : [String(value)]
      return (
        <span className="break-words text-foreground" title={codes.join(', ')}>
          {(opts ? codes.map((c) => optionLabel(opts, c)) : codes).join(', ')}
        </span>
      )
    }

    case 'select': {
      const field = MEMBER_SELECT_FIELDS[def.key]
      // A boolean-backed select stores true/false, not the option string.
      const code = field?.boolean ? String(value === true) : String(value)
      return (
        <span className="break-words text-foreground" title={code}>
          {field ? optionLabel(field.options, code) : code}
        </span>
      )
    }

    case 'photo':
      return <PhotoValue fileId={String(value)} alt={def.label} />

    case 'team':
      return <TeamValue teamId={relId(value)} teams={ctx.teamOptions} />

    case 'date':
      return <span className="break-words text-foreground">{formatDateDisplay(value)}</span>

    case 'datetime':
      return <span className="break-words text-foreground">{formatDateTimeDisplay(value)}</span>

    case 'json': {
      const text = (() => {
        try { return JSON.stringify(value, null, 2) } catch { return String(value) }
      })()
      return (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[11px] text-foreground">
          {text}
        </pre>
      )
    }

    case 'longtext':
      return <p className="whitespace-pre-wrap break-words text-foreground">{String(value)}</p>

    default:
      return <span className="break-words text-foreground">{String(value)}</span>
  }
}

/** Swiss dd.mm.yyyy. Hardcodes the format rather than a locale-dependent one. */
function formatDateDisplay(value: unknown): string {
  const iso = String(value).slice(0, 10)
  const [yyyy, mm, dd] = iso.split('-')
  if (!yyyy || !mm || !dd) return String(value)
  return `${dd}.${mm}.${yyyy}`
}

/** Swiss dd.mm.yyyy HH:MM, 24h, de-CH pinned. */
function formatDateTimeDisplay(value: unknown): string {
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', '')
}

/** Thumbnail + the file id, so a broken asset is still diagnosable. */
function PhotoValue({ fileId, alt }: { fileId: string; alt: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="inline-flex items-center gap-2">
      {!broken && (
        <img
          src={assetUrl(fileId, 'width=96&height=96&fit=cover')}
          alt={alt}
          className="h-12 w-12 rounded-full border border-border object-cover"
          onError={() => setBroken(true)}
        />
      )}
      <span className="break-all font-mono text-[10px] text-muted-foreground">{fileId}</span>
    </span>
  )
}

function TeamValue({ teamId, teams }: { teamId: string | null; teams: TeamPickerOption[] }) {
  const { t } = useTranslation('admin')
  if (!teamId) {
    return <span className="text-muted-foreground">{t('explorerFieldsRequestedTeamNone')}</span>
  }
  const team = teams.find((o) => o.id === teamId)
  return <span className="break-words text-foreground">{team?.label ?? `#${teamId}`}</span>
}

/** Playing positions — reuses the profile picker's labels, not a second list.
 *  ⚠ Those keys live in the `teams` namespace, NOT `auth` (unlike the coaching
 *  qualifications right below) — the wrong one renders the bare key. */
function PositionValue({ value }: { value: unknown }) {
  const { t } = useTranslation('teams')
  const codes = coercePositions(value)
  if (codes.length === 0) return <EmptyValue />
  return (
    <span className="break-words text-foreground" title={codes.join(', ')}>
      {codes.map((p) => {
        const key = getPositionI18nKey(p)
        return key ? t(key) : p
      }).join(', ')}
    </span>
  )
}

/** Coaching education — stored codes rendered as their proper labels ("J+S"). */
function TrainerLicencesValue({ value }: { value: string }) {
  const { t } = useTranslation('auth')
  const codes = parseTrainerLicences(value)
  if (codes.length === 0) return <EmptyValue />
  return (
    <span className="break-words text-foreground">
      {codes.map((c) => t(TRAINER_LICENCE_I18N_KEYS[c])).join(', ')}
    </span>
  )
}

/** 'NONE' is an explicit "never licensed elsewhere", not a missing answer. */
function FederationValue({ value }: { value: string }) {
  const { t } = useTranslation('admin')
  const code = value.trim().toUpperCase()
  const label = code === NO_FEDERATION ? t('federationNone') : (countryLabel(code) || code)
  return <span className="break-words text-foreground">{label}</span>
}

// ── Editors ────────────────────────────────────────────────────────────

/**
 * The control that edits one field, chosen by `def.kind` alone.
 *
 * Exported so the bulk-edit modal composes a value with the SAME control the
 * member detail uses. A second set of inputs over there is how a select becomes
 * a text box for one caller and starts writing values the column has never seen.
 */
export function FieldEditor({
  def,
  value,
  ctx,
  onChange,
}: {
  def: MemberFieldDef
  value: unknown
  ctx: FieldEditorCtx
  onChange: (v: unknown) => void
}) {
  const { t } = useTranslation(['admin', 'auth', 'common', 'teams'])
  const asText = typeof value === 'string' ? value : value == null ? '' : String(value)
  // ⚠ The normalizing inputs keep a `lastEmitted` ref and resync only when the
  // incoming value differs from what they last emitted. They emit `null` for
  // empty, so they must be fed `null` too — handing them `''` makes every empty
  // field look like an external change and fights the caret while typing.
  const asNullable = typeof value === 'string' && value !== '' ? value : null

  switch (def.kind) {
    // Secrets are never editable and never even hold their value in memory.
    case 'readonlyMasked':
      return null

    case 'email':
      return <EmailInput value={asNullable} onChange={onChange} disabled={ctx.disabled} />

    case 'phone':
      return <PhoneInput value={asNullable} onChange={onChange} disabled={ctx.disabled} />

    case 'ahv':
      return <AhvInput value={asNullable} onChange={onChange} disabled={ctx.disabled} />

    case 'iban':
      return <IbanInput value={asNullable} onChange={onChange} disabled={ctx.disabled} />

    case 'postalcode':
      return <PostalCodeInput value={asNullable} onChange={onChange} disabled={ctx.disabled} />

    case 'photo':
      return (
        <PhotoPicker
          value={typeof value === 'string' ? value : null}
          onChange={onChange}
          alt={def.label}
          disabled={ctx.disabled}
        />
      )

    case 'teamMulti': {
      const link = ctx.teamLinks[def.key]
      if (!link) return null
      return (
        <TeamPickerMulti
          value={link.ids}
          onChange={link.onChange}
          teams={ctx.teamOptions}
          busyIds={link.busy}
          disabled={ctx.disabled}
        />
      )
    }

    case 'team':
      return (
        <TeamPickerSingle
          value={relId(value)}
          // The column is an integer — convert at the boundary.
          onChange={(id) => onChange(id == null ? null : Number(id))}
          teams={ctx.teamOptions}
          disabled={ctx.disabled}
          emptyLabel={t('admin:explorerFieldsRequestedTeamNone')}
        />
      )

    case 'countryMulti':
      // Order-preserving: the first code is the primary and is what gets pushed
      // to ClubDesk. Empty serialises to null, never ''.
      return (
        <CountryMultiSelect
          selected={parseCountryCodes(typeof value === 'string' ? value : '')}
          onChange={(codes) => onChange(serializeCountryCodes(codes))}
          helperText={t('auth:nationalitaetHint')}
        />
      )

    case 'country':
      return (
        <SearchableSelect
          options={[{ value: NO_FEDERATION, label: t('admin:federationNone') }, ...countryOptions()]}
          value={typeof value === 'string' ? value.trim().toUpperCase() : ''}
          onChange={(v) => onChange(v === '' ? null : v)}
          searchPlaceholder={t('common:searchCountry')}
        />
      )

    case 'trainerLicences':
      return <TrainerLicenceEditor value={value} sport={ctx.sport} onChange={onChange} />

    case 'positions':
      return <PositionsEditor value={value} sport={ctx.sport} onChange={onChange} />

    case 'multiselect': {
      const options = MEMBER_MULTI_FIELDS[def.key]
      if (!options) return <JsonEditor value={value} onChange={onChange} />
      return <MultiSelectEditor options={options} value={value} onChange={onChange} />
    }

    case 'select': {
      const field = MEMBER_SELECT_FIELDS[def.key]
      if (!field) return <TextEditor value={asText} onChange={onChange} />
      // A boolean column round-trips through the select as 'true' / 'false';
      // null stays null (the third state, "derive it"). Without the conversion
      // the PATCH would write the STRING "true" into a boolean column.
      return (
        <SelectEditor
          options={field.options}
          nullable={field.nullable}
          noneLabel={field.noneLabel}
          value={field.boolean ? (value == null ? null : String(value === true)) : value}
          onChange={field.boolean ? (v) => onChange(v == null ? null : v === 'true') : onChange}
        />
      )
    }

    case 'suggest': {
      // Free text with a canonical suggestion list — off-list values exist in
      // the data (fee categories especially) and must stay typeable.
      const listId = `explorer-suggest-${def.key}`
      const suggestions = MEMBER_SUGGEST_FIELDS[def.key] ?? []
      return (
        <>
          <Input
            type="text"
            list={listId}
            className="min-h-[44px]"
            value={asText}
            disabled={ctx.disabled}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          />
          <datalist id={listId}>
            {suggestions.map((opt) => <option key={opt} value={opt} />)}
          </datalist>
        </>
      )
    }

    case 'bool': {
      const on = Boolean(value)
      return (
        <div className="flex min-h-[44px] items-center gap-2">
          <Switch checked={on} disabled={ctx.disabled} onCheckedChange={onChange} />
          <span
            className={
              on
                ? 'font-medium text-emerald-600 dark:text-emerald-400'
                : 'font-medium text-red-600 dark:text-red-400'
            }
          >
            {on ? 'Yes' : 'No'}
          </span>
        </div>
      )
    }

    case 'number':
      return (
        <Input
          type="number"
          inputMode="numeric"
          className="min-h-[44px]"
          disabled={ctx.disabled}
          value={value === null || value === undefined || value === '' ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') { onChange(null); return }
            const n = Number(raw)
            // Keep the previous value rather than writing NaN into an integer.
            if (Number.isNaN(n)) return
            onChange(n)
          }}
        />
      )

    case 'date':
      return (
        <DatePicker
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(v) => onChange(v || null)}
          disabled={ctx.disabled}
        />
      )

    case 'datetime':
      return (
        <DateTimePicker
          value={toLocalPickerValue(value)}
          onChange={(dt) => onChange(dt ? new Date(dt).toISOString() : null)}
          disabled={ctx.disabled}
        />
      )

    case 'json':
      return <JsonEditor value={value} onChange={onChange} />

    case 'longtext':
      return (
        <textarea
          value={asText}
          rows={3}
          disabled={ctx.disabled}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className="min-h-[44px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      )

    default:
      return <TextEditor value={asText} onChange={onChange} disabled={ctx.disabled} />
  }
}

/**
 * Stored UTC ISO → the LOCAL `YYYY-MM-DDTHH:mm` string DateTimePicker speaks.
 * ⚠ Not `iso.slice(0, 16)`: that hands the picker a UTC wall clock while the
 * save path reads it back as local, so the value drifts an hour on every
 * open/save round trip and the field never settles back to clean.
 */
function toLocalPickerValue(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Clearing a text field on a NULL column must write `null`, never `''`. */
function TextEditor({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: unknown) => void
  disabled?: boolean
}) {
  return (
    <Input
      type="text"
      className="min-h-[44px]"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    />
  )
}

function JsonEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const text = (() => {
    if (value == null) return ''
    if (typeof value === 'string') return value
    try { return JSON.stringify(value, null, 2) } catch { return String(value) }
  })()
  return (
    <textarea
      value={text}
      rows={Math.min(10, Math.max(3, text.split('\n').length))}
      onChange={(e) => {
        const raw = e.target.value
        if (raw.trim() === '') { onChange(null); return }
        // Unparseable text is stored raw rather than blocking the save — the
        // operator can still fix it, and a hard block loses their work.
        try { onChange(JSON.parse(raw)) } catch { onChange(raw) }
      }}
      className="min-h-[44px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

/**
 * Playing positions — the profile picker's own option set, so the explorer can
 * never offer a position the app does not render. A legacy value already on the
 * record stays selectable.
 */
function PositionsEditor({
  value,
  sport,
  onChange,
}: {
  value: unknown
  sport: MemberSport
  onChange: (v: unknown) => void
}) {
  const { t } = useTranslation('teams')
  const selected = coercePositions(value)
  // 'both' → undefined, which is how getPositionsForSport spells "offer all".
  const sportArg = sport === 'both' ? undefined : (sport as Team['sport'])
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {getSelectablePositions(sportArg, value).map((p) => {
        const i18nKey = getPositionI18nKey(p)
        return (
          <label
            key={p}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground"
          >
            <input
              type="checkbox"
              checked={selected.includes(p)}
              onChange={(e) => {
                onChange(e.target.checked
                  ? [...selected, p]
                  : selected.filter((c) => c !== p))
              }}
              className="size-5 accent-primary"
            />
            {i18nKey ? t(i18nKey) : p}
          </label>
        )
      })}
    </div>
  )
}

/**
 * Coaching qualification. Checkboxes, never a text input — the DB CHECK would
 * 400 on a typo and the admin would have to guess the accepted spelling.
 * ⚠ J+S/C/B/A (Swiss Volley) and T1/T2/T3 (Swiss Basketball) are two separate
 * ladders. T2 is NOT B. The offered set is the member's own sport plus whatever
 * is already stored, so an off-sport legacy value can still be unticked.
 */
function TrainerLicenceEditor({
  value,
  sport,
  onChange,
}: {
  value: unknown
  sport: MemberSport
  onChange: (v: unknown) => void
}) {
  const { t } = useTranslation('auth')
  const selected = parseTrainerLicences(typeof value === 'string' ? value : '')
  const base: readonly TrainerLicence[] =
    sport === 'both' ? TRAINER_LICENCE_CODES : TRAINER_LICENCE_CODES_BY_SPORT[sport]
  // Filtering the canonical list keeps JS/C/B/A/T1/T2/T3 order regardless of
  // which set a code came from.
  // ⚠ 'JS' is in NEITHER sport list by design (trainerLicences.ts): J+S is the
  // federal leader track and applies to both, so every caller has to union it
  // back in — exactly as ProfileEditForm does. Without this a volleyball coach
  // who does not already hold J+S can never be given it.
  const offered = TRAINER_LICENCE_CODES.filter(
    (c) => c === 'JS' || base.includes(c) || selected.includes(c),
  )
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {offered.map((code) => (
        <label
          key={code}
          className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground"
        >
          <input
            type="checkbox"
            checked={selected.includes(code)}
            onChange={(e) => {
              const next = e.target.checked
                ? [...selected, code]
                : selected.filter((c) => c !== code)
              onChange(serializeTrainerLicences(next))
            }}
            className="size-5 accent-primary"
          />
          {t(TRAINER_LICENCE_I18N_KEYS[code])}
        </label>
      ))}
    </div>
  )
}

// Radix Select refuses an empty-string item value, so "no value" travels as a
// sentinel and is mapped back to null on the way out.
const NONE_VALUE = '__none__'

function SelectEditor({
  options,
  nullable,
  noneLabel,
  value,
  onChange,
}: {
  options: FieldOption[]
  nullable: boolean
  /** What the null option reads as. "—" ("no value") unless the column's null
   *  MEANS something — e.g. "Automatic" for the surcharge tri-state. */
  noneLabel?: string
  value: unknown
  onChange: (v: unknown) => void
}) {
  const current = typeof value === 'string' && value !== '' ? value : ''
  // An off-list value (legacy data, or a code added to the DB before this list)
  // stays selected and selectable — otherwise opening the editor on such a row
  // and saving anything else would silently overwrite it.
  const shown = current && !options.some((o) => o.value === current)
    ? [{ value: current, label: `${current} (unrecognised)` }, ...options]
    : options
  return (
    <Select
      value={current === '' ? NONE_VALUE : current}
      onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
    >
      <SelectTrigger className="min-h-[44px] w-full text-sm">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {nullable && <SelectItem value={NONE_VALUE}>{noneLabel ?? '—'}</SelectItem>}
        {shown.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MultiSelectEditor({
  options,
  value,
  onChange,
}: {
  options: FieldOption[]
  value: unknown
  onChange: (v: unknown) => void
}) {
  const selected = Array.isArray(value) ? (value as unknown[]).map(String) : []
  // Same off-list rule as SelectEditor — an unknown code keeps its checkbox.
  const shown = [
    ...options,
    ...selected
      .filter((c) => !options.some((o) => o.value === c))
      .map((c) => ({ value: c, label: `${c} (unrecognised)` })),
  ]
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {shown.map((o) => (
        <label
          key={o.value}
          className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground"
        >
          <input
            type="checkbox"
            checked={selected.includes(o.value)}
            onChange={(e) => {
              onChange(e.target.checked
                ? [...selected, o.value]
                : selected.filter((c) => c !== o.value))
            }}
            className="size-5 accent-primary"
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}
