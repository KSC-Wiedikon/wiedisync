import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import Modal from '../../../components/Modal'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { HALL_A, HALL_B, HALL_AB } from '../utils/probasketSeason'
import { opponentsFor, sexForGroup, hasGroupData } from '../data/basketballGroups'
import type { Team, BasketballSlotPlan } from '../../../types'
import type { PlaceGameInput } from '../hooks/useBasketballPlan'

interface Props {
  open: boolean
  onClose: () => void
  date: string
  time: string
  /** The clicked hall (KWI A/B/C). */
  hall: string
  /** Whether A and B are both free so a combined A+B court can be offered. */
  canCombineAB: boolean
  teams: Team[]
  existing?: BasketballSlotPlan | null
  /** Pre-selected KSCW team (the one highlighted in the grid). */
  defaultTeamId?: string
  /** Other placed games within a few days — shown for context while planning. */
  nearbyGames?: { date: string; time: string; hall: string; label: string }[]
  onPlace: (hall: string, input: PlaceGameInput) => Promise<void>
  onRemove?: () => Promise<void>
}

export default function PlaceGameModal({
  open, onClose, date, time, hall, canCombineAB, teams, existing, defaultTeamId, nearbyGames, onPlace, onRemove,
}: Props) {
  const { t } = useTranslation('basketballScheduling')
  const [teamId, setTeamId] = useState<string>(existing?.kscw_team ? String(existing.kscw_team) : (defaultTeamId ?? ''))
  const [freeTeam, setFreeTeam] = useState<string>(existing?.kscw_team_label ?? '')
  const [opponent, setOpponent] = useState<string>(existing?.opponent ?? '')
  const [note, setNote] = useState<string>(existing?.note ?? '')
  const [combined, setCombined] = useState<boolean>(existing?.hall === HALL_AB)
  const [gameType, setGameType] = useState<'home' | 'guest'>(existing?.game_type ?? 'home')
  const [saving, setSaving] = useState(false)

  const team = useMemo(() => teams.find((tm) => String(tm.id) === teamId) ?? null, [teams, teamId])
  const bbSource = team?.bb_source_id ?? null
  const sex = useMemo(() => (team ? sexForGroup(bbSource) : existing?.sex ?? null), [team, bbSource, existing])
  const opponents = useMemo(() => (team ? opponentsFor(bbSource) : []), [team, bbSource])
  // The two ProBasket Classics squads are registered outside the Teamanmeldungen
  // workbook, so no group — and therefore no opponent list — exists for them. An
  // empty datalist is indistinguishable from a broken one, so say so instead.
  const noGroupData = !!team && !hasGroupData(bbSource)

  const canBeCombined = (hall === HALL_A || hall === HALL_B) && (canCombineAB || existing?.hall === HALL_AB)
  const targetHall = canBeCombined && combined ? HALL_AB : hall
  const hasTeam = !!teamId || !!freeTeam.trim()

  async function save() {
    if (!hasTeam) return
    setSaving(true)
    try {
      await onPlace(targetHall, {
        kscw_team: teamId || null,
        kscw_team_label: teamId ? null : freeTeam.trim() || null,
        opponent: opponent.trim() || null,
        sex: sex ?? null,
        game_type: gameType,
        note: note.trim() || null,
      })
      onClose()
    } catch {
      toast.error(t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  const selectClass = 'w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm dark:bg-gray-800'

  return (
    <Modal open={open} onClose={onClose} title={`${t('placeGame')} — ${formatDateZurich(date)} · ${time} · ${targetHall}`}>
      <div className="space-y-4">
        {/* Home (KSCW hosts) vs guest game */}
        <div className="flex gap-1">
          {(['home', 'guest'] as const).map((gt) => (
            <button
              key={gt}
              type="button"
              onClick={() => setGameType(gt)}
              className={`flex-1 rounded px-3 py-1.5 text-sm ${
                gameType === gt ? 'bg-brand-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {t(`type_${gt}`)}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <Label>{t('kscwTeam')}</Label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={selectClass}>
            <option value="">{t('freeTextTeam')}</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.name}</option>
            ))}
          </select>
          {!teamId && (
            <Input
              value={freeTeam}
              onChange={(e) => setFreeTeam(e.target.value)}
              placeholder={t('teamNamePlaceholder')}
              className="mt-1"
            />
          )}
          {team && sex && (
            <p className="text-xs text-muted-foreground">
              {t('sex')}: {t(`sex_${sex}`)}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label>{t('opponent')}</Label>
          <Input
            list={opponents.length ? 'bb-opponents' : undefined}
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder={
              noGroupData
                ? t('opponentTypeFree')
                : team
                  ? t('opponentPlaceholder')
                  : t('opponentPickTeamFirst')
            }
          />
          {opponents.length > 0 && (
            <datalist id="bb-opponents">
              {opponents.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
          {noGroupData && <p className="text-xs text-muted-foreground">{t('opponentNoGroupData')}</p>}
        </div>

        {canBeCombined && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={combined} onChange={(e) => setCombined(e.target.checked)} />
            {t('useCombinedAB')}
          </label>
        )}

        <div className="space-y-1">
          <Label>{t('note')}</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
        </div>

        {nearbyGames && nearbyGames.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
            <p className="mb-1 font-medium text-muted-foreground">{t('nearbyGames')}</p>
            <ul className="space-y-0.5">
              {nearbyGames.map((g, i) => (
                <li key={i} className="text-muted-foreground">
                  {formatDateZurich(g.date)} · {g.time} · {g.hall} — {g.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          {existing && onRemove ? (
            <Button
              variant="destructive"
              onClick={async () => {
                setSaving(true)
                try {
                  await onRemove()
                  onClose()
                } finally {
                  setSaving(false)
                }
              }}
              disabled={saving}
            >
              {t('remove')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button onClick={save} disabled={saving || !hasTeam}>
              {t('save')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
