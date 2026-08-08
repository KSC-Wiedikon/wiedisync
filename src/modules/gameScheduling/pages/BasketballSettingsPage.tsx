import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { CalendarOff, Loader2 } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { kscwApi } from '../../../lib/api'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import ClubBlockedDatesPanel from '../components/ClubBlockedDatesPanel'
import TeamLinksEditor from '../components/TeamLinksEditor'
import BasketballTeamRulesPanel from '../components/BasketballTeamRulesPanel'
import BasketballTimeslotMatrixPanel, { type BbSlotConfig } from '../components/BasketballTimeslotMatrixPanel'
import BasketballSlotGenerationPanel from '../components/BasketballSlotGenerationPanel'
import BasketballOffersPanel from '../components/BasketballOffersPanel'
import BasketballDatePrefsPanel from '../components/BasketballDatePrefsPanel'
import BasketballClubPortalsPanel from '../components/BasketballClubPortalsPanel'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballPlan } from '../hooks/useBasketballPlan'
import { useBasketballDatePrefs } from '../hooks/useBasketballDatePrefs'
import { useBasketballTeamRules } from '../hooks/useBasketballTeamRules'
import { useBasketballSlots } from '../hooks/useBasketballSlots'
import { useBasketballOffers } from '../hooks/useBasketballOffers'
import { useBasketballClubPortals } from '../hooks/useBasketballClubPortals'

interface ClubBlock {
  id: number
  start_date: string
  end_date: string
  reason: string | null
}

/**
 * Read-only view of the club-wide blackout dates for non-superadmins. The dates
 * are club-wide (they also drive volleyball slot generation) and the panel's
 * POST/DELETE are superadmin-only server-side, so a basketball planner gets the
 * list without the editor. GET /terminplanung/admin/club-blocked-dates is open
 * to any authenticated user (game-scheduling.js: `if (!req.accountability?.user)
 * return 401`), so this loads for planners too.
 */
function ClubBlockedDatesReadOnly() {
  const { t } = useTranslation('basketballScheduling')
  const { data, isLoading } = useQuery<ClubBlock[]>({
    queryKey: ['bb-prep', 'club-blocked-dates'],
    queryFn: async () => {
      // Swallow like useBasketballPlan's registrant of this same query key — a
      // transient failure leaves the list empty rather than breaking the page.
      try {
        const res = await kscwApi<{ blocks: ClubBlock[] }>('/terminplanung/admin/club-blocked-dates')
        return res?.blocks ?? []
      } catch {
        return []
      }
    },
    staleTime: 60_000,
  })
  const blocks = data ?? []

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2">
        <CalendarOff className="h-5 w-5 text-gray-500 dark:text-gray-400" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('blockedDates')}</h3>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('blockedDatesReadOnlyHint')}</p>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-gray-400"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
      ) : blocks.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">{t('blockedDatesEmpty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('blockedDatesColDates')}</TableHead>
              <TableHead>{t('blockedDatesColReason')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocks.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="whitespace-normal break-words font-medium tabular-nums">
                  {b.start_date === b.end_date
                    ? formatDateZurich(b.start_date)
                    : `${formatDateZurich(b.start_date)} – ${formatDateZurich(b.end_date)}`}
                </TableCell>
                <TableCell className="whitespace-normal break-words text-gray-500 dark:text-gray-400">{b.reason || '–'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

/**
 * Basketball scheduling settings.
 *
 * Deliberately NOT volleyball's settings page. ProBasket owns the basketball schedule
 * (physical Spielplansitzung + Basketplan), so there is no Spielsamstag booking engine,
 * no derby anchoring, no SVRZ sync and no opponent invite lifecycle here. What basketball
 * needs is the club's own constraint matrix, the club-level timeslot rules, and a
 * generator that turns the two into a candidate inventory. The only genuinely shared
 * panels are the club-wide blocked dates (which also drive volleyball generation) and the
 * sport-agnostic team links.
 */
export default function BasketballSettingsPage() {
  const { t } = useTranslation('basketballScheduling')
  const { isSuperAdmin } = useAuth()
  const { season, allSeasons, setSeason, updateSeason } = useGameSchedulingSeason()
  const { teams, links, addLink, updateLink, removeLink } = useBasketballPlan(season)
  const { byTeam: rulesByTeam, isLoading: rulesLoading, error: rulesError, saveRule, createRule, removeRule } =
    useBasketballTeamRules(season?.id)
  const {
    slots, availableByTeam, generating, clearing, result, generate, clearSlots, error: slotsError,
  } = useBasketballSlots(season?.id)
  // Opponent-club flow (migrations 279/280): which placed home games are offered to
  // which club, and the per-club portal links + invite mail.
  const offers = useBasketballOffers(season?.id)
  const portals = useBasketballClubPortals(season?.id)
  // What the clubs answered through their portals (migration 296) — availabilities, not
  // bookings, so this panel only reads.
  const datePrefs = useBasketballDatePrefs(season?.id)

  const selectClass = 'rounded-md border border-border bg-transparent px-3 py-2 text-sm dark:bg-gray-800'

  /** basketplan_clubs.id → how many placed home games are addressed to it. */
  const gamesByClub = useMemo(() => {
    const m = new Map<string, number>()
    for (const [clubId, rows] of offers.byClub) m.set(clubId, rows.length)
    return m
  }, [offers.byClub])

  // The club-level half of the slot config lives on the (sport-neutral) season row as
  // jsonb (migration 278). It reaches the client through BaseRecord's index signature,
  // so it is `unknown` until narrowed here.
  const bbSlotConfig = (season?.bb_slot_config as BbSlotConfig | undefined) ?? null

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('settingsTitle')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('settingsSubtitle')}</p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted-foreground">{t('season')}</span>
          <select
            className={selectClass}
            value={season?.id ?? ''}
            onChange={(e) => setSeason(allSeasons.find((s) => String(s.id) === e.target.value) ?? null)}
          >
            {allSeasons.map((s) => (
              <option key={s.id} value={s.id}>{s.season}</option>
            ))}
          </select>
        </label>
      </header>

      {/* The rules table and the generator both live behind migration 278 + the
          basketball-slots endpoint. Until BOTH are deployed the panels below would look
          simply empty, which reads as "no rules configured" — say so instead. */}
      {(rulesError || slotsError) && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          {t('backendUnavailable')}
        </p>
      )}

      {!season ? (
        <p className="text-sm text-muted-foreground">{t('noSeason')}</p>
      ) : (
        <>
          {/* Slot generation — the action, on top; the rules that feed it follow. */}
          <BasketballSlotGenerationPanel
            teams={teams}
            rulesByTeam={rulesByTeam}
            slots={slots}
            availableByTeam={availableByTeam}
            generating={generating}
            clearing={clearing}
            result={result}
            onGenerate={generate}
            onClear={clearSlots}
          />

          {/* Per-team constraint matrix */}
          <BasketballTeamRulesPanel
            teams={teams}
            byTeam={rulesByTeam}
            saveRule={saveRule}
            createRule={createRule}
            removeRule={removeRule}
            isLoading={rulesLoading}
          />

          {/* Club-level timeslot matrix + Spielsamstage */}
          <BasketballTimeslotMatrixPanel
            config={bbSlotConfig}
            onUpdate={async (cfg) => {
              await updateSeason(season.id, { bb_slot_config: cfg } as Record<string, unknown>)
            }}
          />

          {/* Opponent flow — address the placed games to a club, then the per-club
              portal links + the German invite mail. Deliberately NOT gated on
              `season.status === 'open'`: prod's only season is 'closed' and
              basketball has no invite-close lifecycle, so that gate would ship a
              permanently disabled button. */}
          <BasketballOffersPanel
            games={offers.games}
            clubs={portals.clubs}
            teams={teams}
            isLoading={offers.isLoading || portals.isLoading}
            busy={offers.busy}
            assignClub={offers.assignClub}
            offer={offers.offer}
            unoffer={offers.unoffer}
            answerClubProposal={offers.answerClubProposal}
          />

          <BasketballDatePrefsPanel
            groups={datePrefs.groups}
            clubsAnswered={datePrefs.clubsAnswered}
            isLoading={datePrefs.isLoading}
            error={datePrefs.error}
          />

          <BasketballClubPortalsPanel
            clubs={portals.clubs}
            portals={portals.portals}
            portalByClub={portals.portalByClub}
            isLoading={portals.isLoading}
            busy={portals.busy}
            hasError={!!portals.error}
            ensure={portals.ensure}
            reissue={portals.reissue}
            revoke={portals.revoke}
            send={portals.send}
            saveClubContact={portals.saveClubContact}
            gamesByClub={gamesByClub}
          />
        </>
      )}

      {/* Coach/player-sharing team links (sport-agnostic editor) */}
      <TeamLinksEditor teams={teams} links={links} addLink={addLink} updateLink={updateLink} removeLink={removeLink} />

      {/* Club-wide blocked dates (shared with volleyball — they also drive
          volleyball slot generation). Editing is superadmin-only, mirroring the
          volleyball settings page (`{isSuperAdmin && <ClubBlockedDatesPanel />}`)
          and the superadmin-gated POST/DELETE; everyone else sees the list
          read-only, because a basketball planner still has to know which days
          are blacked out. */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('blockedDates')}</h2>
        {isSuperAdmin ? <ClubBlockedDatesPanel /> : <ClubBlockedDatesReadOnly />}
      </section>
    </div>
  )
}
