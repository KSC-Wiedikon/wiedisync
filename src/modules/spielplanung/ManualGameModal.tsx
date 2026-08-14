import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, AlertTriangle, Home as HomeIcon, Plane } from 'lucide-react'
import Modal from '../../components/Modal'
import { Button } from '../../components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import DatePicker from '../../components/ui/DatePicker'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import { useTeams } from '../../hooks/useTeams'
import { useGameConflicts } from './hooks/useGameConflicts'
import { buildManualGamePayload, type ManualGamePayloadInput } from './utils/manualGamePayload'
import { toDateKey } from '../../utils/dateUtils'
import { asObj } from '../../utils/relations'
import type { Hall, Team, Game, HallSlot } from '../../types'
import type { SportFilter, GameTypeFilter } from '../../types/calendar'
import { cn } from '../../lib/utils'

const HALL_COMBO_AB = 'combo:A+B'

type SportChoice = 'all' | 'volleyball' | 'basketball'

interface ManualGameModalProps {
  open: boolean
  onClose: () => void
  /** Team IDs (as strings) the caller is allowed to create games for. */
  editableTeamIds: string[]
  /** Prefills the date field when opened from a day cell (create mode only). */
  initialDate?: Date | null
  /** When set, the modal opens in edit mode preloaded with this game's values. */
  editingGame?: Game | null
  /** Main-page sport filter — seeds the sport selector (create mode only). */
  initialSport?: SportFilter
  /** Main-page home/away filter — seeds the H/A toggle (create mode only). */
  initialGameType?: GameTypeFilter
  /** Main-page team filter — when exactly one is selected, prefills the team (create mode only). */
  initialSelectedTeamIds?: string[]
}

function defaultTime(): string {
  return '16:00'
}

export default function ManualGameModal({
  open,
  onClose,
  editableTeamIds,
  initialDate,
  editingGame,
  initialSport,
  initialGameType,
  initialSelectedTeamIds,
}: ManualGameModalProps) {
  const { t } = useTranslation('spielplanung')
  const { data: allTeams } = useTeams('all')
  const { data: halls } = useCollection<Hall>('halls', {
    sort: ['name'],
    all: true,
    fields: ['id', 'name', 'address', 'city'],
  })
  const { create, update, isLoading } = useMutation('games')
  const isEditMode = !!editingGame

  const editableTeams = useMemo(
    () => (allTeams ?? []).filter((t) => editableTeamIds.includes(String(t.id))),
    [allTeams, editableTeamIds],
  )

  // ── Form state ─────────────────────────────────────────────────────
  // Sport gates the team dropdown — 'all' shows every editable team.
  const [sport, setSport] = useState<SportChoice>('all')
  const [teamId, setTeamId] = useState<string>('')

  // Teams the dropdown offers, narrowed by the chosen sport.
  const sportFilteredTeams = useMemo(
    () => (sport === 'all' ? editableTeams : editableTeams.filter((t) => t.sport === sport)),
    [editableTeams, sport],
  )
  const [type, setType] = useState<'home' | 'away'>('home')
  const [opponent, setOpponent] = useState('')
  const [date, setDate] = useState<string>(() =>
    initialDate ? toDateKey(initialDate) : toDateKey(new Date()),
  )
  const [time, setTime] = useState<string>(defaultTime)
  const [hallId, setHallId] = useState<string>('')
  const [additionalHalls, setAdditionalHalls] = useState<string[]>([])
  const [saturdayHintHall, setSaturdayHintHall] = useState<string>('')
  const [awayVenue, setAwayVenue] = useState({ name: '', address: '', city: '', plus_code: '' })
  const [league, setLeague] = useState('')
  const [round, setRound] = useState('')
  const [autoConfirmRsvp, setAutoConfirmRsvp] = useState<boolean | null>(null)
  const [teamAutoConfirmDefault, setTeamAutoConfirmDefault] = useState(false)
  const [autoNominationList, setAutoNominationList] = useState<boolean | null>(null)
  const [teamAutoNominationDefault, setTeamAutoNominationDefault] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Prop → form seeding ────────────────────────────────────────────
  // Every block below used to be a `useEffect` that did nothing but write form
  // state from props. They now run during render (React's sanctioned
  // adjust-state-during-render) so nothing writes state synchronously from an
  // effect. Each keeps its original source position — the blocks read state that
  // earlier blocks write, and render-phase updates re-run the component the same
  // way an effect cascade re-runs on the next commit, so the ordering and the
  // fixed point they converge to are unchanged. Each `prev…` tracker starts as
  // `null` so the block also fires on the first render, mirroring the effect's
  // mount run.
  //
  // INVARIANT — every value in a `…SeedDeps` array must be a primitive or a
  // referentially STABLE object across renders. These blocks compare with
  // `Object.is`, so a value whose identity changes on every render makes the
  // tracker write state on every render, and a render-phase write re-renders
  // immediately: an infinite loop, not a stale seed. That is React #301 ("Too many
  // re-renders"), and it took down the prod Spielplanung page on 2026-07-14 when
  // `useTeams` returned a fresh `[]` while its query was in flight. An effect would
  // merely have re-run; a render-phase update crashes. Pass arrays by a joined key.

  // Prefill date on (re)open (create mode)
  const dateSeedDeps: unknown[] = [open, initialDate, editingGame]
  const [prevDateSeed, setPrevDateSeed] = useState<unknown[] | null>(null)
  if (prevDateSeed === null || dateSeedDeps.some((d, i) => !Object.is(d, prevDateSeed[i]))) {
    setPrevDateSeed(dateSeedDeps)
    if (open && initialDate && !editingGame) setDate(toDateKey(initialDate))
  }

  // Prefill from existing game on open (edit mode)
  const editSeedDeps: unknown[] = [open, editingGame]
  const [prevEditSeed, setPrevEditSeed] = useState<unknown[] | null>(null)
  if (prevEditSeed === null || editSeedDeps.some((d, i) => !Object.is(d, prevEditSeed[i]))) {
    setPrevEditSeed(editSeedDeps)
    seedFromEditingGame()
  }
  function seedFromEditingGame() {
    if (!open || !editingGame) return
    const teamRel = asObj<Team>(editingGame.kscw_team)
    setTeamId(String(teamRel?.id ?? editingGame.kscw_team ?? ''))
    setSport(teamRel?.sport === 'basketball' || teamRel?.sport === 'volleyball' ? teamRel.sport : 'all')
    setType(editingGame.type)
    setOpponent(
      editingGame.type === 'home'
        ? editingGame.away_team ?? ''
        : editingGame.home_team ?? '',
    )
    setDate(editingGame.date)
    // time comes back as HH:MM:SS — trim seconds for the <input type="time">
    setTime((editingGame.time ?? '16:00').slice(0, 5))
    const hallRel = asObj<Hall>(editingGame.hall)
    setHallId(hallRel ? String(hallRel.id) : editingGame.hall ? String(editingGame.hall) : '')
    setAdditionalHalls(
      Array.isArray(editingGame.additional_halls)
        ? editingGame.additional_halls.map((v) => String(typeof v === 'object' && v !== null && 'id' in v ? (v as { id: unknown }).id : v))
        : [],
    )
    setSaturdayHintHall('')
    const ah = editingGame.away_hall_json
    setAwayVenue({
      name: ah?.name ?? '',
      address: ah?.address ?? '',
      city: ah?.city ?? '',
      plus_code: ah?.plus_code ?? '',
    })
    setLeague(editingGame.league ?? '')
    setRound(editingGame.round ?? '')
    const rawAcr = (editingGame as Game & { auto_confirm_rsvp?: boolean | null }).auto_confirm_rsvp
    setAutoConfirmRsvp(rawAcr === true ? true : rawAcr === false ? false : null)
    const rawAnl = editingGame.auto_nomination_list
    setAutoNominationList(rawAnl === true ? true : rawAnl === false ? false : null)
  }

  // Load team defaults for the auto-confirm / auto-Einsatzliste hint labels
  const autoConfirmDeps: unknown[] = [open, teamId, allTeams]
  const [prevAutoConfirm, setPrevAutoConfirm] = useState<unknown[] | null>(null)
  if (prevAutoConfirm === null || autoConfirmDeps.some((d, i) => !Object.is(d, prevAutoConfirm[i]))) {
    setPrevAutoConfirm(autoConfirmDeps)
    if (!open || !teamId) {
      setTeamAutoConfirmDefault(false)
      setTeamAutoNominationDefault(false)
    } else {
      const teamRel = (allTeams ?? []).find((t) => String(t.id) === teamId) as Team | undefined
      const fe = teamRel?.features_enabled as
        | { game_auto_confirm?: boolean; auto_nomination_list?: boolean }
        | undefined
      setTeamAutoConfirmDefault(fe?.game_auto_confirm === true)
      setTeamAutoNominationDefault(fe?.auto_nomination_list === true)
    }
  }

  // Seed sport + home/away from the main-page filters on open (create mode).
  // Runs only when those inputs change, so it never clobbers a manual edit.
  const filterSeedDeps: unknown[] = [open, editingGame, initialSport, initialGameType]
  const [prevFilterSeed, setPrevFilterSeed] = useState<unknown[] | null>(null)
  if (prevFilterSeed === null || filterSeedDeps.some((d, i) => !Object.is(d, prevFilterSeed[i]))) {
    setPrevFilterSeed(filterSeedDeps)
    if (open && !editingGame) {
      setSport(initialSport === 'volleyball' || initialSport === 'basketball' ? initialSport : 'all')
      if (initialGameType === 'home' || initialGameType === 'away') setType(initialGameType)
    }
  }

  // Prefill the team: prefer the main-page team filter (exactly one selected &
  // editable), else fall back to the single editable team when there's only one.
  // Both team lists are compared by a primitive key, not by array identity: a
  // caller that passes a fresh array literal each render would otherwise make this
  // block re-fire forever (see the invariant note above).
  const teamSeedDeps: unknown[] = [
    open,
    editableTeams.map((t) => t.id).join(','),
    teamId,
    editingGame,
    (initialSelectedTeamIds ?? []).join(','),
  ]
  const [prevTeamSeed, setPrevTeamSeed] = useState<unknown[] | null>(null)
  if (prevTeamSeed === null || teamSeedDeps.some((d, i) => !Object.is(d, prevTeamSeed[i]))) {
    setPrevTeamSeed(teamSeedDeps)
    seedTeamId()
  }
  function seedTeamId() {
    if (!open || teamId || editingGame) return
    if (initialSelectedTeamIds && initialSelectedTeamIds.length === 1) {
      const tid = String(initialSelectedTeamIds[0])
      if (editableTeams.some((t) => String(t.id) === tid)) {
        setTeamId(tid)
        return
      }
    }
    if (editableTeams.length === 1) {
      setTeamId(String(editableTeams[0]!.id))
    }
  }

  // Drop the team if it no longer belongs to the newly-chosen sport.
  function handleSportChange(next: SportChoice) {
    setSport(next)
    if (next !== 'all' && teamId) {
      const tm = editableTeams.find((t) => String(t.id) === teamId)
      if (tm && tm.sport !== next) setTeamId('')
    }
  }

  // Reset form on close
  const [prevOpen, setPrevOpen] = useState<boolean | null>(null)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setSport('all')
      setTeamId('')
      setType('home')
      setOpponent('')
      setTime(defaultTime())
      setHallId('')
      setAdditionalHalls([])
      setSaturdayHintHall('')
      setAwayVenue({ name: '', address: '', city: '', plus_code: '' })
      setLeague('')
      setRound('')
      setAutoConfirmRsvp(null)
      setTeamAutoConfirmDefault(false)
      setAutoNominationList(null)
      setTeamAutoNominationDefault(false)
      setSubmitError(null)
    }
  }

  // ── Conflict check ────────────────────────────────────────────────
  const selectedTeam = editableTeams.find((t) => String(t.id) === teamId) as Team | undefined
  // Volleymanager (and therefore the Einsatzliste) exists for volleyball only.
  const isVolleyball = selectedTeam?.sport === 'volleyball'
  const kwiA = useMemo(() => (halls ?? []).find((h) => h.name === 'KWI A'), [halls])
  const kwiB = useMemo(() => (halls ?? []).find((h) => h.name === 'KWI B'), [halls])
  const kwiC = useMemo(() => (halls ?? []).find((h) => h.name === 'KWI C'), [halls])
  // KWI A+B combo books both halls at once — offered for any sport so a single
  // booking blocks A and B and trips the hall-overlap conflict check on either.
  const canOfferCombo = !!kwiA && !!kwiB

  // Saturday training slot lookup (volleyball teams only — drives the hint)
  const isSaturday = useMemo(() => {
    if (!date) return false
    return new Date(date + 'T00:00:00').getDay() === 6
  }, [date])

  const { data: saturdayTrainingSlots } = useCollection<HallSlot>('hall_slots', {
    filter:
      teamId && isSaturday && selectedTeam?.sport === 'volleyball'
        ? {
            _and: [
              { day_of_week: { _eq: 6 } },
              { slot_type: { _eq: 'training' } },
              { recurring: { _eq: true } },
              { teams: { teams_id: { _eq: teamId } } },
            ],
          }
        : undefined,
    fields: ['id', 'hall', 'start_time', 'end_time'],
    all: true,
    enabled: !!teamId && isSaturday && selectedTeam?.sport === 'volleyball',
    staleTime: 60_000,
  })

  // Derived: is the current selection the A+B combo?
  const isComboSelected =
    !!kwiA &&
    !!kwiB &&
    hallId === String(kwiA.id) &&
    additionalHalls.length === 1 &&
    additionalHalls[0] === String(kwiB.id)

  const hallSelectValue = isComboSelected ? HALL_COMBO_AB : hallId

  function onHallSelectChange(value: string) {
    setSaturdayHintHall('') // user took over
    if (value === HALL_COMBO_AB && kwiA && kwiB) {
      setHallId(String(kwiA.id))
      setAdditionalHalls([String(kwiB.id)])
      return
    }
    setHallId(value)
    setAdditionalHalls([])
  }

  // ── VB Saturday prefill (create mode only) ─────────────────────────
  const satSeedDeps: unknown[] = [
    open,
    editingGame,
    selectedTeam,
    isSaturday,
    type,
    hallId,
    halls,
    saturdayTrainingSlots,
    kwiC,
    kwiA,
    kwiB,
  ]
  const [prevSatSeed, setPrevSatSeed] = useState<unknown[] | null>(null)
  if (prevSatSeed === null || satSeedDeps.some((d, i) => !Object.is(d, prevSatSeed[i]))) {
    setPrevSatSeed(satSeedDeps)
    seedSaturdayHall()
  }
  function seedSaturdayHall() {
    if (!open || editingGame) return
    if (!selectedTeam || selectedTeam.sport !== 'volleyball') return
    if (!isSaturday || type !== 'home') return
    if (hallId !== '') return // don't override manual choice
    if (!halls || halls.length === 0) return

    // Priority: own Sat training slot hall → KWI C → KWI A → KWI B
    const trainingHall =
      saturdayTrainingSlots && saturdayTrainingSlots.length > 0
        ? String(saturdayTrainingSlots[0].hall)
        : ''
    const fallback = kwiC?.id ?? kwiA?.id ?? kwiB?.id ?? ''
    const pick = trainingHall || String(fallback)
    if (!pick) return
    setHallId(pick)
    setAdditionalHalls([])
    setSaturdayHintHall(pick)
  }

  const { errors, warnings } = useGameConflicts({
    editingId: editingGame?.id,
    kscw_team: teamId,
    hall: type === 'home' ? hallId : null,
    additional_halls: type === 'home' ? additionalHalls : null,
    date,
    time,
    type,
    teams: allTeams,
    halls,
    enabled: !!teamId && !!date && !!time,
  })

  const blocked = errors.length > 0
  const requiredFilled =
    !!teamId && !!opponent.trim() && !!date && !!time && (type === 'away' || !!hallId)

  // ── Submit ────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    if (blocked || !requiredFilled || !selectedTeam) return

    const input: ManualGamePayloadInput = {
      kscw_team: teamId,
      type,
      opponent: opponent.trim(),
      date,
      time,
      hall: type === 'home' ? hallId : null,
      additional_halls:
        type === 'home' && additionalHalls.length > 0 ? additionalHalls : null,
      away_hall_json:
        type === 'away' && awayVenue.name.trim()
          ? {
              name: awayVenue.name.trim(),
              address: awayVenue.address.trim(),
              city: awayVenue.city.trim(),
              plus_code: awayVenue.plus_code.trim() || undefined,
            }
          : null,
      league: league.trim(),
      round: round.trim(),
      auto_confirm_rsvp: autoConfirmRsvp,
      // Volleyball-only — basketball has no Volleymanager, so it always inherits (null).
      auto_nomination_list: isVolleyball ? autoNominationList : null,
    }

    try {
      // The season is stamped inside the builder, from the game date — see the
      // warning there before ever passing one in again.
      const payload = buildManualGamePayload(input, selectedTeam.name)
      if (isEditMode && editingGame) {
        // On edit, keep the original game_id + source so we don't rename in-place.
        const { game_id: _gid, ...rest } = payload
        void _gid
        await update(editingGame.id, rest)
      } else {
        await create(payload)
      }
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditMode ? t('manualGame.editTitle') : t('manualGame.title')}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEditMode && <p className="text-sm text-muted-foreground">{t('manualGame.subtitle')}</p>}

        {/* Sport — gates the team dropdown */}
        <div>
          <Label htmlFor="sport">{t('manualGame.sport')}</Label>
          <Select value={sport} onValueChange={(v) => handleSportChange(v as SportChoice)}>
            <SelectTrigger id="sport">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filterAll')}</SelectItem>
              <SelectItem value="volleyball">{t('filterVolleyball')}</SelectItem>
              <SelectItem value="basketball">{t('filterBasketball')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Team */}
        <div>
          <Label htmlFor="team">{t('manualGame.team')} *</Label>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger id="team">
              <SelectValue placeholder={t('manualGame.teamPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {sportFilteredTeams.map((team) => (
                <SelectItem key={team.id} value={String(team.id)}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Home/Away + Opponent */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>{t('manualGame.homeAway')} *</Label>
            <div className="mt-1 grid grid-cols-2 gap-1 rounded-md border bg-muted/30 p-1">
              <button
                type="button"
                onClick={() => setType('home')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium transition-colors',
                  type === 'home'
                    ? 'bg-gold-400 text-brand-900'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <HomeIcon className="h-4 w-4" aria-hidden /> {t('manualGame.home')}
              </button>
              <button
                type="button"
                onClick={() => setType('away')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium transition-colors',
                  type === 'away'
                    ? 'bg-gold-400 text-brand-900'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Plane className="h-4 w-4" aria-hidden /> {t('manualGame.away')}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="opponent">{t('manualGame.opponent')} *</Label>
            <Input
              id="opponent"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder={t('manualGame.opponentPlaceholder')}
            />
          </div>
        </div>

        {/* Date / Time */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="date">{t('manualGame.date')} *</Label>
            <DatePicker
              id="date"
              value={date}
              onChange={(v) => v && setDate(v)}
            />
          </div>
          <div>
            <Label htmlFor="time">{t('manualGame.time')} *</Label>
            <Input
              id="time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="dark:bg-gray-800"
            />
          </div>
        </div>

        {/* Hall (home) or Away venue (away) */}
        {type === 'home' ? (
          <div>
            <Label htmlFor="hall">{t('manualGame.hall')} *</Label>
            <Select value={hallSelectValue} onValueChange={onHallSelectChange}>
              <SelectTrigger id="hall">
                <SelectValue placeholder={t('manualGame.hallPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {canOfferCombo && (
                  <SelectItem value={HALL_COMBO_AB}>
                    {t('manualGame.hallComboAB')}
                  </SelectItem>
                )}
                {(halls ?? []).map((h) => (
                  <SelectItem key={h.id} value={String(h.id)}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {saturdayHintHall && hallId === saturdayHintHall && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('manualGame.saturdayHint', {
                  hall: halls?.find((h) => String(h.id) === saturdayHintHall)?.name ?? '',
                })}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2 rounded-md border p-3">
            <Label className="text-xs uppercase text-muted-foreground">
              {t('manualGame.awayVenue')}
            </Label>
            <Input
              value={awayVenue.name}
              onChange={(e) => setAwayVenue((v) => ({ ...v, name: e.target.value }))}
              placeholder={t('manualGame.venueName')}
            />
            <Input
              value={awayVenue.address}
              onChange={(e) => setAwayVenue((v) => ({ ...v, address: e.target.value }))}
              placeholder={t('manualGame.venueAddress')}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={awayVenue.city}
                onChange={(e) => setAwayVenue((v) => ({ ...v, city: e.target.value }))}
                placeholder={t('manualGame.venueCity')}
              />
              <Input
                value={awayVenue.plus_code}
                onChange={(e) => setAwayVenue((v) => ({ ...v, plus_code: e.target.value }))}
                placeholder={t('manualGame.venuePlusCode')}
              />
            </div>
          </div>
        )}

        {/* League + Round (optional) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="league">{t('manualGame.league')}</Label>
            <Input
              id="league"
              value={league}
              onChange={(e) => setLeague(e.target.value)}
              placeholder={t('manualGame.leaguePlaceholder')}
            />
          </div>
          <div>
            <Label htmlFor="round">{t('manualGame.round')}</Label>
            <Input id="round" value={round} onChange={(e) => setRound(e.target.value)} />
          </div>
        </div>

        {/* Auto-confirm RSVP override */}
        <div className="space-y-1.5 text-sm">
          <div>
            <Label className="font-medium">{t('manualGame.autoConfirmRsvp', { defaultValue: 'Auto-confirm RSVP' })}</Label>
            <p className="text-xs text-muted-foreground">
              {t('manualGame.autoConfirmRsvpHint', {
                defaultValue: 'Override team default ({{def}}). All eligible members start as confirmed; they must opt out.',
                def: teamAutoConfirmDefault ? t('manualGame.on', { defaultValue: 'On' }) : t('manualGame.off', { defaultValue: 'Off' }),
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              { value: null, label: t('manualGame.useTeamDefault', { defaultValue: 'Use team default' }) },
              { value: true, label: t('manualGame.on', { defaultValue: 'On' }) },
              { value: false, label: t('manualGame.off', { defaultValue: 'Off' }) },
            ] as { value: boolean | null; label: string }[]).map((opt) => {
              const active = autoConfirmRsvp === opt.value
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setAutoConfirmRsvp(opt.value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-brand-500 bg-brand-100 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300'
                      : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Auto Einsatzliste override — volleyball only (no Volleymanager for basketball) */}
        {isVolleyball && (
          <div className="space-y-1.5 text-sm">
            <div>
              <Label className="font-medium">{t('games:autoNomination')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('games:autoNominationHint', {
                  def: teamAutoNominationDefault ? t('games:autoNominationOn') : t('games:autoNominationOff'),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                { value: null, label: t('games:autoNominationUseTeamDefault') },
                { value: true, label: t('games:autoNominationOn') },
                { value: false, label: t('games:autoNominationOff') },
              ] as { value: boolean | null; label: string }[]).map((opt) => {
                const active = autoNominationList === opt.value
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setAutoNominationList(opt.value)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-brand-500 bg-brand-100 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300'
                        : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800',
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Conflict banner */}
        {errors.length > 0 && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                {errors.map((e, i) => (
                  <div key={i}>{t(`manualGame.conflict.${e.messageKey}`, e.context ?? {})}</div>
                ))}
              </div>
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                {warnings.map((w, i) => (
                  <div key={i}>{t(`manualGame.conflict.${w.messageKey}`, w.context ?? {})}</div>
                ))}
              </div>
            </div>
          </div>
        )}
        {submitError && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common:cancel', 'Cancel')}
          </Button>
          <Button type="submit" disabled={blocked || !requiredFilled || isLoading}>
            {isLoading
              ? t('common:saving', 'Saving…')
              : isEditMode
                ? t('manualGame.save')
                : t('manualGame.create')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
