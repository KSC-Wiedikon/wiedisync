import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { CalendarOff, Loader2 } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { kscwApi } from '../../../lib/api'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import ClubBlockedDatesPanel from '../components/ClubBlockedDatesPanel'
import TeamLinksEditor from '../components/TeamLinksEditor'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useBasketballPlan } from '../hooks/useBasketballPlan'

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

export default function BasketballSettingsPage() {
  const { t } = useTranslation('basketballScheduling')
  const { isSuperAdmin } = useAuth()
  const { season, allSeasons, setSeason } = useGameSchedulingSeason()
  const { teams, links, addLink, updateLink, removeLink } = useBasketballPlan(season)

  const selectClass = 'rounded-md border border-border bg-transparent px-3 py-2 text-sm dark:bg-gray-800'

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold">{t('settingsTitle')}</h1>
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

      {/* Coach/player-sharing team links (sport-agnostic editor) */}
      <TeamLinksEditor teams={teams} links={links} addLink={addLink} updateLink={updateLink} removeLink={removeLink} />
    </div>
  )
}
