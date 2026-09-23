import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import RsvpCheck, { type RsvpState } from '../../../components/RsvpCheck'
import LoadingSpinner from '../../../components/LoadingSpinner'
import { kscwApi } from '../../../lib/api'
import { formatDateZurich } from '../../../utils/dateHelpers'

interface SheetRow {
  /** null when the Einsatzliste names a licence we hold no member for — not editable. */
  member: number | null
  /** RSVP cross-check. null → nothing to check (see RsvpCheck). */
  rsvp?: RsvpState
  number: number | null
  last_name: string
  first_initial: string
  birthdate: string | null
  is_captain: boolean
  is_libero: boolean
  licence?: string | null
  eligible?: boolean
  added: boolean
  dropped: boolean
}

interface BenchRow {
  member: number
  /** RSVP cross-check — here it surfaces the inverse: confirmed but NOT nominated. */
  rsvp?: RsvpState
  number: number | null
  last_name: string
  first_initial: string
  birthdate: string | null
  is_libero: boolean
}

type OfficialRole = 'coach' | 'assistant_coach_1' | 'assistant_coach_2' | 'physio' | 'doctor'

/** The scoresheet's order — the officials block always reads in it. */
const OFFICIAL_ROLES: OfficialRole[] = ['coach', 'assistant_coach_1', 'assistant_coach_2', 'physio', 'doctor']
const roleRank = (role: OfficialRole | null) => {
  const i = role ? OFFICIAL_ROLES.indexOf(role) : -1
  return i === -1 ? OFFICIAL_ROLES.length : i
}
const sortOfficials = <T extends { role: OfficialRole | null }>(list: T[]) =>
  [...list].sort((a, b) => roleRank(a.role) - roleRank(b.role))

interface OfficialRow {
  /** Opaque server identity — sent back on save; name/DoB are never trusted from us. */
  ref: string
  member: number | null
  last_name: string
  first_initial: string
  birthdate: string | null
  /** VM names the slot; our own junction cannot, so a team-coach fallback is null. */
  role: OfficialRole | null
}

interface Candidate {
  ref: string
  member: number
  first_name: string
  last_name: string
}

interface SheetResponse {
  data: {
    game: { home_team: string; away_team: string; date: string; time: string | null }
    access: 'admin' | 'scorer' | 'coach'
    can_edit: boolean
    /** 'vm' = the Einsatzliste filed in Volleymanager; 'rsvp' = confirmed RSVPs. */
    source: 'vm' | 'rsvp'
    edited: boolean
    edited_by: string | null
    officials_edited: boolean
    roster: SheetRow[]
    coaches: OfficialRow[]
    bench: BenchRow[]
  }
}

interface PreGameRosterModalProps {
  gameId: string
  onClose: () => void
}

const nameOf = (r: { last_name: string; first_initial: string }) =>
  `${r.last_name}${r.first_initial ? `, ${r.first_initial}` : ''}`

/**
 * The match sheet, for the coach or team responsible of the playing team.
 *
 * Laid out the way the sheet is actually filled — birthdate, number, "Last, F." — with
 * the captain's number circled, liberos repeated in their own block (as on the paper
 * sheet), and officials at the bottom. The coach hands the phone to the scorer.
 *
 * EDITING. Number, captain and libero do not exist on Volleymanager's Einsatzliste, so
 * changing them cannot contradict it — they are ours alone, and they are saved per game
 * (never back onto members.number / members.position / teams.captain, which are
 * club-wide and would be rewritten for every other team by one Saturday's tweak).
 *
 * Adding or dropping a PLAYER does diverge from the Einsatzliste. That is the emergency
 * door, and it is the only edit that raises the red banner: we do not push it to
 * Volleymanager, so the coach must make the same change there by hand.
 */
export default function PreGameRosterModal({ gameId, onClose }: PreGameRosterModalProps) {
  const { t } = useTranslation('games')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [data, setData] = useState<SheetResponse['data'] | null>(null)
  const [rows, setRows] = useState<SheetRow[]>([])
  const [bench, setBench] = useState<BenchRow[]>([])
  const [officials, setOfficials] = useState<OfficialRow[]>([])
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apply = useCallback((d: SheetResponse['data']) => {
    setData(d)
    setRows(d.roster)
    setBench(d.bench ?? [])
    setOfficials(sortOfficials(d.coaches ?? []))
    setErrorCode(null)
  }, [])

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  // Initial load. Every setState sits inside a promise callback, never in the effect
  // body: a synchronous setState in an effect cascades a render (RosterModal documents
  // the same constraint). Callers key this modal on gameId, so a new game gets a fresh
  // instance whose initial state is already loading/empty.
  useEffect(() => {
    let cancelled = false
    kscwApi<SheetResponse>(`/scorer/game/${gameId}/roster`)
      .then((res) => { if (!cancelled) apply(res.data) })
      .catch((err: Error & { code?: string }) => { if (!cancelled) setErrorCode(err.code || 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [gameId, apply])

  /** Re-read after a write. Only ever called from an event handler, never an effect. */
  const fetchSheet = useCallback(async () => {
    try {
      apply((await kscwApi<SheetResponse>(`/scorer/game/${gameId}/roster`)).data)
    } catch (err) {
      setErrorCode((err as Error & { code?: string }).code || 'error')
    }
  }, [gameId, apply])

  // The read view is always in jersey order (unnumbered last), whatever the coach
  // did to the numbers while editing — the server sorts too, but a bench add or a
  // renumber lands in the edit order until the sheet is re-read.
  const live = useMemo(
    () => rows.filter((r) => !r.dropped).sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity)),
    [rows],
  )
  const liberos = useMemo(() => live.filter((r) => r.is_libero), [live])
  const addedCount = useMemo(() => rows.filter((r) => r.added).length, [rows])
  const droppedCount = useMemo(() => rows.filter((r) => r.dropped).length, [rows])
  // Only a changed player SET diverges from the Einsatzliste. Numbers and K/L are ours.
  const diverges = addedCount > 0 || droppedCount > 0

  // Only what actually changed is written: saving the officials must not freeze the
  // players into a snapshot (which would stop later Einsatzliste re-reads), and v.v.
  const playersDirty = useMemo(
    () => data != null && JSON.stringify(rows) !== JSON.stringify(data.roster),
    [rows, data],
  )
  const officialsDirty = useMemo(
    () => data != null
      && JSON.stringify(officials.map((o) => [o.ref, o.role]))
        !== JSON.stringify(sortOfficials(data.coaches).map((o) => [o.ref, o.role])),
    [officials, data],
  )

  /** Give an official a slot. A slot holds one person: whoever had it takes this one's old slot. */
  const setOfficialRole = (ref: string, role: OfficialRole | null) => {
    setOfficials((prev) => {
      const from = prev.find((o) => o.ref === ref)?.role ?? null
      return sortOfficials(prev.map((o) => {
        if (o.ref === ref) return { ...o, role }
        if (role != null && o.role === role) return { ...o, role: from }
        return o
      }))
    })
  }

  const removeOfficial = (ref: string) => setOfficials((prev) => prev.filter((o) => o.ref !== ref))

  const addOfficial = (c: Candidate) => {
    setOfficials((prev) => {
      if (prev.some((o) => o.ref === c.ref)) return prev
      // First free slot, so a new person lands somewhere sensible; the coach can change it.
      const taken = new Set(prev.map((o) => o.role))
      const role = OFFICIAL_ROLES.find((r) => !taken.has(r)) ?? null
      return sortOfficials([...prev, {
        ref: c.ref,
        member: c.member,
        last_name: c.last_name,
        first_initial: c.first_name ? `${c.first_name.charAt(0).toUpperCase()}.` : '',
        birthdate: null, // attached server-side on save
        role,
      }])
    })
    setSearch('')
    setCandidates([])
  }

  const onSearch = (q: string) => {
    setSearch(q)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.trim().length < 2) { setCandidates([]); setSearching(false); return }
    setSearching(true)
    searchTimer.current = setTimeout(() => {
      kscwApi<{ data: Candidate[] }>(`/scorer/game/${gameId}/official-candidates?q=${encodeURIComponent(q.trim())}`)
        .then((res) => setCandidates(res.data))
        .catch(() => setCandidates([]))
        .finally(() => setSearching(false))
    }, 250)
  }

  const setRow = (member: number | null, patch: Partial<SheetRow>) => {
    if (member == null) return
    setRows((prev) => prev.map((r) => (r.member === member ? { ...r, ...patch } : r)))
  }

  const toggleCaptain = (member: number | null) => {
    if (member == null) return
    setRows((prev) => prev.map((r) => ({
      ...r,
      is_captain: r.member === member ? !r.is_captain : false,
    })))
  }

  const removeRow = (row: SheetRow) => {
    if (row.member == null) return
    if (row.added) {
      // An added player simply leaves again — back to the bench.
      setRows((prev) => prev.filter((r) => r.member !== row.member))
      setBench((prev) => [...prev, {
        member: row.member as number,
        number: row.number,
        last_name: row.last_name,
        first_initial: row.first_initial,
        birthdate: row.birthdate,
        is_libero: row.is_libero,
      }])
      return
    }
    setRow(row.member, { dropped: !row.dropped, is_captain: false, is_libero: row.dropped ? row.is_libero : false })
  }

  const addFromBench = (b: BenchRow) => {
    setBench((prev) => prev.filter((x) => x.member !== b.member))
    setRows((prev) => [...prev, {
      member: b.member,
      number: b.number,
      last_name: b.last_name,
      first_initial: b.first_initial,
      birthdate: b.birthdate,
      is_captain: false,
      is_libero: b.is_libero,
      licence: null,
      eligible: true,
      added: true,
      dropped: false,
    }])
  }

  /** Leave edit mode WITHOUT saving: back to the sheet as the server holds it. */
  const cancelEdit = () => {
    if (data) apply(data)
    setSearch('')
    setCandidates([])
    setEditing(false)
  }

  const save = async () => {
    setSaving(true)
    try {
      if (officialsDirty) {
        await kscwApi(`/scorer/game/${gameId}/officials`, {
          method: 'POST',
          body: { officials: officials.map((o) => ({ ref: o.ref, role: o.role })) },
        })
      }
      if (playersDirty) {
        await kscwApi(`/scorer/game/${gameId}/roster`, {
          method: 'POST',
          body: {
            players: rows
              .filter((r) => r.member != null)
              .map((r) => ({
                member: r.member,
                number: r.number,
                is_captain: r.is_captain,
                is_libero: r.is_libero,
                dropped: r.dropped,
              })),
            added: rows.filter((r) => r.added && r.member != null).map((r) => r.member),
          },
        })
      }
      setEditing(false)
      await fetchSheet()
    } catch {
      setErrorCode('save_failed')
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setSaving(true)
    try {
      await kscwApi(`/scorer/game/${gameId}/roster`, { method: 'DELETE' })
      setEditing(false)
      await fetchSheet()
    } catch {
      setErrorCode('save_failed')
    } finally {
      setSaving(false)
    }
  }

  const errorMessage = (code: string): string => {
    switch (code) {
      case 'outside_window': return t('pregameOutsideWindow')
      case 'not_scorer': return t('pregameNotAllowed')
      case 'not_home': return t('pregameNoTeam')
      case 'no_time': return t('pregameNoTime')
      case 'save_failed': return t('pregameSaveFailed')
      default: return t('pregameError')
    }
  }

  const officialLabel = (role: OfficialRow['role']): string => {
    switch (role) {
      case 'coach': return t('pregameRoleCoach')
      case 'assistant_coach_1': return t('pregameRoleAssistant1')
      case 'assistant_coach_2': return t('pregameRoleAssistant2')
      case 'physio': return t('pregameRolePhysio')
      case 'doctor': return t('pregameRoleDoctor')
      default: return t('pregameRoleStaff')
    }
  }

  /** The letters printed on the scoresheet: C, AC1, AC2, P, M. */
  const roleCode = (role: OfficialRole): string => ({
    coach: 'C', assistant_coach_1: 'AC1', assistant_coach_2: 'AC2', physio: 'P', doctor: 'M',
  })[role]

  /** The number, circled when this player wears the armband — as on the paper sheet. */
  const jerseyCell = (r: SheetRow) => (
    <span
      title={r.is_captain ? t('pregameCaptain') : undefined}
      className={[
        'inline-grid h-8 w-8 place-items-center text-base font-bold tabular-nums',
        r.is_captain ? 'rounded-full border-2 border-foreground' : '',
      ].join(' ')}
    >
      {r.number ?? '—'}
    </span>
  )

  // Only against a real Einsatzliste. On the RSVP fallback the sheet IS the confirmed
  // RSVPs, so every row would read green and assert a cross-check that never happened.
  const showCheck = data?.source === 'vm'

  const roleSelect = (c: OfficialRow) => (
    <select
      aria-label={t('pregameColRole')}
      value={c.role ?? ''}
      onChange={(e) => setOfficialRole(c.ref, (e.target.value || null) as OfficialRole | null)}
      className="h-11 max-w-full rounded-md border bg-background px-2 text-sm font-bold text-foreground dark:bg-gray-800"
    >
      <option value="">{t('pregameRoleUnassigned')}</option>
      {OFFICIAL_ROLES.map((r) => (
        <option key={r} value={r}>{`${roleCode(r)} · ${officialLabel(r)}`}</option>
      ))}
    </select>
  )

  const removeOfficialButton = (c: OfficialRow) => (
    <button
      type="button"
      title={t('pregameRemoveOfficial')}
      onClick={() => removeOfficial(c.ref)}
      className="h-11 w-11 shrink-0 rounded-md border text-sm font-bold text-destructive"
    >
      ✕
    </button>
  )

  /** K / L / ✕ for one player. Beside the row from sm up; on a phone, a row of its own
   *  beneath the player, so the sheet never scrolls sideways. */
  const playerControls = (r: SheetRow) => (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        aria-pressed={r.is_captain}
        title={t('pregameCaptain')}
        onClick={() => toggleCaptain(r.member)}
        className={[
          'h-11 w-11 rounded-full border text-sm font-bold',
          r.is_captain ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground',
        ].join(' ')}
      >
        {t('pregameCaptainShort')}
      </button>
      <button
        type="button"
        aria-pressed={r.is_libero}
        title={t('pregameLibero')}
        onClick={() => setRow(r.member, { is_libero: !r.is_libero })}
        className={[
          'h-11 w-11 rounded-full border text-sm font-bold',
          r.is_libero ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground',
        ].join(' ')}
      >
        {t('pregameLiberoShort')}
      </button>
      <button
        type="button"
        title={r.dropped ? t('pregamePutBack') : t('pregameRemove')}
        onClick={() => removeRow(r)}
        className="h-11 w-11 rounded-md border text-sm font-bold text-destructive"
      >
        {r.dropped ? '↺' : '✕'}
      </button>
    </div>
  )

  const playerTable = (list: SheetRow[], withControls: boolean) => (
    <Table>
      <TableHeader>
        <TableRow>
          {showCheck && (
            <TableHead className="w-8" title={t('rsvpCheckLegend')}>{t('rsvpCheckHeader')}</TableHead>
          )}
          <TableHead className="w-24">{t('pregameColDob')}</TableHead>
          <TableHead className="w-14 text-center">{t('pregameColNumber')}</TableHead>
          <TableHead>{t('pregameColName')}</TableHead>
          {withControls && <TableHead className="hidden w-32 text-right sm:table-cell">{t('pregameColEdit')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((r, i) => (
          <Fragment key={`${r.member ?? 'x'}-${i}`}>
          <TableRow
            className={[
              r.dropped ? 'opacity-40 line-through' : '',
              // On a phone the controls row below closes the pair — no rule between them.
              withControls && r.member != null ? 'max-sm:border-b-0' : '',
            ].join(' ')}
          >
            {showCheck && (
              <TableCell className="text-center"><RsvpCheck state={r.rsvp ?? null} /></TableCell>
            )}
            <TableCell className="min-h-[44px] whitespace-normal tabular-nums text-xs text-muted-foreground">
              {r.birthdate ? formatDateZurich(r.birthdate) : '—'}
            </TableCell>
            <TableCell className="text-center">
              {withControls && r.member != null ? (
                <input
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  aria-label={t('pregameColNumber')}
                  value={r.number ?? ''}
                  onChange={(e) => setRow(r.member, {
                    number: e.target.value === '' ? null : Number(e.target.value),
                  })}
                  className="h-11 w-14 rounded-md border bg-background text-center text-base font-bold tabular-nums"
                />
              ) : jerseyCell(r)}
            </TableCell>
            <TableCell className="whitespace-normal break-words font-medium">
              {nameOf(r)}
              {r.added && (
                <span
                  title={t('pregameNotOnList')}
                  className="ml-1.5 inline-grid h-4 w-4 place-items-center rounded-full bg-emerald-600 align-middle text-[10px] font-bold text-white"
                >
                  +
                </span>
              )}
              {r.eligible === false && (
                <span title={t('pregameNotEligible')} className="ml-1.5 align-middle text-amber-600 dark:text-amber-500">
                  ⚠
                </span>
              )}
            </TableCell>
            {withControls && (
              <TableCell className="hidden text-right sm:table-cell">
                {r.member != null && playerControls(r)}
              </TableCell>
            )}
          </TableRow>
          {withControls && r.member != null && (
            <TableRow className="sm:hidden">
              <TableCell colSpan={showCheck ? 4 : 3} className="pt-0">
                {playerControls(r)}
              </TableCell>
            </TableRow>
          )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  )

  const sectionTitle = (label: string) => (
    <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </h4>
  )

  return (
    <Modal open onClose={onClose} title={t('pregameTitle')} size="full" disableAutoFocus>
      {/* A match sheet is a narrow document — centred, not stretched across a desktop. */}
      <div className="mx-auto w-full max-w-2xl">
      {data && (
        <>
          <p className="mb-1 text-sm font-medium text-foreground">
            {data.game.home_team} – {data.game.away_team}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            {data.source === 'vm' ? t('pregameSourceVm') : t('pregameSourceRsvp')}
            {data.edited && data.edited_by ? ` · ${t('pregameEditedBy', { name: data.edited_by })}` : ''}
          </p>
        </>
      )}

      {loading && <div className="py-8"><LoadingSpinner /></div>}

      {!loading && errorCode && (
        <p className="py-6 text-center text-sm text-muted-foreground">{errorMessage(errorCode)}</p>
      )}

      {!loading && data && (
        <div className="space-y-5">
          {/* The ONLY edit that can contradict Volleymanager. Loud, and it stays up
              outside edit mode too — a coach who edited on the tram must still see it
              when they reopen the sheet in the hall. */}
          {diverges && (
            <div className="flex items-start gap-3 rounded-lg border-l-4 border-destructive bg-destructive/10 p-3 text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="text-xs leading-relaxed">
                <strong className="block text-sm font-bold">{t('pregameDivergesTitle')}</strong>
                {t('pregameDivergesCount', { added: addedCount, dropped: droppedCount })}
                <strong className="mt-1 block font-bold">{t('pregameDivergesMust')}</strong>
              </div>
            </div>
          )}

          {data.can_edit && (
            <div className="flex flex-wrap gap-2">
              {/* No bare "Done": leaving edit mode either saves or throws the edits away.
                  A toggle that did neither left unsaved changes on screen looking saved. */}
              {editing ? (
                <>
                  <Button onClick={() => void save()} loading={saving}>{t('pregameSave')}</Button>
                  <Button variant="outline" onClick={cancelEdit} disabled={saving}>{t('pregameCancel')}</Button>
                  {(data.edited || data.officials_edited) && (
                    <Button variant="outline" onClick={() => void reset()} disabled={saving}>
                      {t('pregameReset')}
                    </Button>
                  )}
                </>
              ) : (
                <Button variant="outline" onClick={() => setEditing(true)}>{t('pregameEdit')}</Button>
              )}
            </div>
          )}

          <div>
            {sectionTitle(t('pregamePlayers'))}
            {(editing ? rows : live).length > 0
              ? playerTable(editing ? rows : live, editing)
              : <p className="text-center text-sm text-muted-foreground">{t('pregameNoPlayers')}</p>}
          </div>

          {/* The emergency door — only open while editing. */}
          {editing && bench.length > 0 && (
            <div>
              {sectionTitle(t('pregameBench'))}
              <Table>
                <TableBody>
                  {bench.map((b) => (
                    <TableRow key={`b-${b.member}`} className="opacity-70">
                      {showCheck && (
                        <TableCell className="w-8 text-center"><RsvpCheck state={b.rsvp ?? null} /></TableCell>
                      )}
                      <TableCell className="w-24 whitespace-normal tabular-nums text-xs text-muted-foreground">
                        {b.birthdate ? formatDateZurich(b.birthdate) : '—'}
                      </TableCell>
                      <TableCell className="w-14 text-center font-bold tabular-nums">{b.number ?? '—'}</TableCell>
                      <TableCell className="whitespace-normal break-words font-medium">{nameOf(b)}</TableCell>
                      <TableCell className="w-32 text-right">
                        <button
                          type="button"
                          title={t('pregameAdd')}
                          onClick={() => addFromBench(b)}
                          className="h-11 w-11 rounded-md border border-emerald-600 text-lg font-bold text-emerald-600"
                        >
                          +
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Liberos are listed in the players block AND again here — as on the sheet. */}
          {liberos.length > 0 && (
            <div>
              {sectionTitle(t('pregameLiberoSection'))}
              {playerTable(liberos, false)}
            </div>
          )}

          {(officials.length > 0 || editing) && (
            <div>
              {sectionTitle(t('pregameOfficials'))}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">{t('pregameColDob')}</TableHead>
                    <TableHead className={editing ? 'w-14 text-center sm:w-auto' : 'w-14 text-center'}>{t('pregameColRole')}</TableHead>
                    <TableHead>{t('pregameColName')}</TableHead>
                    {editing && <TableHead className="hidden w-14 sm:table-cell" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {officials.map((c) => (
                    <Fragment key={`o-${c.ref}`}>
                    <TableRow className={editing ? 'max-sm:border-b-0' : undefined}>
                      <TableCell className="min-h-[44px] whitespace-normal tabular-nums text-xs text-muted-foreground">
                        {c.birthdate ? formatDateZurich(c.birthdate) : '—'}
                      </TableCell>
                      {/* The scoresheet letters (C / AC1 / AC2 / P / M), in the slot the
                          jersey number takes for a player. */}
                      <TableCell className="text-center">
                        {editing && <span className="hidden sm:inline">{roleSelect(c)}</span>}
                        <span
                          title={officialLabel(c.role)}
                          className={[
                            'h-8 min-w-8 place-items-center text-base font-bold tabular-nums',
                            editing ? 'inline-grid sm:hidden' : 'inline-grid',
                          ].join(' ')}
                        >
                          {c.role ? roleCode(c.role) : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal break-words font-medium">{nameOf(c)}</TableCell>
                      {editing && (
                        <TableCell className="hidden text-right sm:table-cell">{removeOfficialButton(c)}</TableCell>
                      )}
                    </TableRow>
                    {editing && (
                      <TableRow className="sm:hidden">
                        <TableCell colSpan={3} className="pt-0">
                          <div className="flex items-center justify-end gap-2">
                            {roleSelect(c)}
                            {removeOfficialButton(c)}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>

              {/* Anyone active in the club — a physio, a stand-in coach from another team. */}
              {editing && (
                <div className="mt-3">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder={t('pregameOfficialSearch')}
                    aria-label={t('pregameAddOfficial')}
                    className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                  />
                  {search.trim().length >= 2 && !searching && (
                    candidates.filter((c) => !officials.some((o) => o.ref === c.ref)).length > 0 ? (
                      <Table>
                        <TableBody>
                          {candidates
                            .filter((c) => !officials.some((o) => o.ref === c.ref))
                            .map((c) => (
                              <TableRow key={`c-${c.ref}`}>
                                <TableCell className="whitespace-normal break-words font-medium">
                                  {c.last_name} {c.first_name}
                                </TableCell>
                                <TableCell className="w-14 text-right">
                                  <button
                                    type="button"
                                    title={t('pregameAddOfficial')}
                                    onClick={() => addOfficial(c)}
                                    className="h-11 w-11 rounded-md border border-emerald-600 text-lg font-bold text-emerald-600"
                                  >
                                    +
                                  </button>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">{t('pregameOfficialNoResults')}</p>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </Modal>
  )
}
