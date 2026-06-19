import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { XCircle, ChevronRight, Mail, Phone, Award, Calendar, TrendingUp, AlertCircle, AlertTriangle } from 'lucide-react'
import { differenceInYears } from 'date-fns'
import { useCollection } from '../../lib/query'
import { useAuth } from '../../hooks/useAuth'
import TeamChip from '../../components/TeamChip'
import StatusBadge from '../../components/StatusBadge'
import EmptyState from '../../components/EmptyState'
import LoadingSpinner from '../../components/LoadingSpinner'
import { getFileUrl } from '../../utils/fileUrl'
import { coercePositions, getPositionI18nKey } from '../../utils/memberPositions'
import { asObj, relId, memberName } from '../../utils/relations'
import { formatDate, getCurrentSeason, getSeasonDateRange, todayLocal } from '../../utils/dateHelpers'
import ImageLightbox from '../../components/ImageLightbox'
import type { Member, MemberTeam, Team, Absence, Participation } from '../../types'
import { fetchAllItems, fetchItem } from '../../lib/api'
import StartDmButton from '../messaging/components/StartDmButton'

type ExpandedMemberTeam = MemberTeam & { team: Team | string }

export default function PlayerProfile() {
  const { t } = useTranslation('teams')
  const { t: tm } = useTranslation('messaging')
  const { memberId } = useParams<{ memberId: string }>()
  const [searchParams] = useSearchParams()
  const fromTeam = searchParams.get('from')
  const { isCoachOf, isAdmin } = useAuth()
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const { data: memberTeamsRaw, isLoading: memberTeamsLoading } = useCollection<ExpandedMemberTeam>('member_teams', {
    // Current-season only — otherwise archived same-name teams (e.g. old + new
    // "H3" after a rollover) render as duplicate badges.
    filter: memberId ? { _and: [{ member: { _eq: memberId } }, { season: { _eq: getCurrentSeason() } }] } : { id: { _eq: -1 } },
    fields: ['*', 'team.*'],
    limit: 20,
  })
  const memberTeams = memberTeamsRaw ?? []

  const season = getCurrentSeason()
  const { start, end } = getSeasonDateRange(season)

  const { data: absencesRaw, isLoading: absencesLoading } = useCollection<Absence>('absences', {
    filter: memberId ? { _and: [{ member: { _eq: memberId } }, { end_date: { _gte: todayLocal() } }] } : { id: { _eq: -1 } },
    sort: ['start_date'],
    limit: 20,
  })
  const absences = absencesRaw ?? []

  const [trainingStats, setTrainingStats] = useState<{ total: number; present: number } | null>(null)
  const [gameStats, setGameStats] = useState<{ total: number; present: number } | null>(null)

  useEffect(() => {
    if (!memberId) return
    setLoading(true)
    fetchItem<Member>('members', memberId)
      .then(setMember)
      .catch(() => setMember(null))
      .finally(() => setLoading(false))
  }, [memberId])

  // Training attendance
  useEffect(() => {
    if (!memberId || !memberTeams?.length) return
    const teamIds = memberTeams.map((mt) => relId(mt.team))
    Promise.all([
      fetchAllItems<{ id: string; date: string }>('trainings', {
        filter: { _and: [{ team: { _in: teamIds } }, { date: { _gte: start } }, { date: { _lte: end } }, { cancelled: { _eq: false } }] },
        fields: ['id', 'date'],
      }),
      fetchAllItems<Participation>('participations', {
        filter: { _and: [{ member: { _eq: memberId } }, { activity_type: { _eq: 'training' } }] },
      }),
      fetchAllItems<Absence>('absences', {
        filter: { _and: [{ member: { _eq: memberId } }, { end_date: { _gte: start } }, { start_date: { _lte: end } }] },
      }),
    ])
      .then(([trainings, participations, seasonAbsences]) => {
        let present = 0
        let excused = 0
        for (const training of trainings) {
          const trainingDate = training.date.split(' ')[0]
          const hasAbsence = seasonAbsences.some(
            (a) => a.start_date <= trainingDate && a.end_date >= trainingDate,
          )
          if (hasAbsence) {
            excused++
          } else {
            const p = participations.find((p) => p.activity_id === training.id)
            if (p?.status === 'confirmed') present++
          }
        }
        const countable = trainings.length - excused
        setTrainingStats({ total: countable, present })
      })
      .catch(() => setTrainingStats(null))
  }, [memberId, memberTeams, start, end])

  // Game attendance
  useEffect(() => {
    if (!memberId || !memberTeams?.length) return
    const teamIds = memberTeams.map((mt) => relId(mt.team))
    Promise.all([
      fetchAllItems<{ id: string; date: string }>('games', {
        filter: { _and: [{ kscw_team: { _in: teamIds } }, { date: { _gte: start } }, { date: { _lte: end } }, { _or: [{ status: { _neq: 'postponed' } }, { status: { _null: true } }] }] },
        fields: ['id', 'date'],
      }),
      fetchAllItems<Participation>('participations', {
        filter: { _and: [{ member: { _eq: memberId } }, { activity_type: { _eq: 'game' } }] },
      }),
      fetchAllItems<Absence>('absences', {
        filter: { _and: [{ member: { _eq: memberId } }, { end_date: { _gte: start } }, { start_date: { _lte: end } }] },
      }),
    ])
      .then(([games, participations, seasonAbsences]) => {
        let present = 0
        let excused = 0
        for (const game of games) {
          const gameDate = game.date.split(' ')[0]
          const hasAbsence = seasonAbsences.some(
            (a) => a.start_date <= gameDate && a.end_date >= gameDate,
          )
          if (hasAbsence) {
            excused++
          } else {
            const p = participations.find((p) => p.activity_id === game.id)
            if (p?.status === 'confirmed') present++
          }
        }
        const countable = games.length - excused
        setGameStats({ total: countable, present })
      })
      .catch(() => setGameStats(null))
  }, [memberId, memberTeams, start, end])

  if (loading || memberTeamsLoading || absencesLoading) {
    return <LoadingSpinner />
  }

  if (!member) {
    return <EmptyState icon={<XCircle className="h-10 w-10" />} title="Player not found" />
  }

  const initials = `${member.first_name?.[0] ?? ''}${member.last_name?.[0] ?? ''}`.toUpperCase()
  const positions = coercePositions(member.position)
  const trainingPct = trainingStats && trainingStats.total > 0
    ? Math.round((trainingStats.present / trainingStats.total) * 100)
    : null
  const gamePct = gameStats && gameStats.total > 0
    ? Math.round((gameStats.present / gameStats.total) * 100)
    : null

  // Resolve the "from" team for breadcrumb
  const fromTeamData = fromTeam
    ? asObj<Team>(memberTeams.find((mt) => asObj<Team>(mt.team)?.name === fromTeam)?.team)
    : null

  const isCoach = memberTeams.some((mt) => isCoachOf(relId(mt.team)))

  // Absence status: currently absent, soon absent, or count
  const today = todayLocal()
  const in30Days = new Date(new Date(today).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const currentlyAbsent = absences.some(a => a.start_date <= today && a.end_date >= today)
  const soonAbsent = !currentlyAbsent && absences.some(a => a.start_date > today && a.start_date <= in30Days)

  return (
    <div className="mx-auto max-w-3xl">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <Link to="/teams" className="transition-colors hover:text-gray-700 dark:hover:text-gray-200">
          {t('title')}
        </Link>
        {fromTeamData && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <Link
              to={`/teams/${fromTeamData.name}`}
              className="transition-colors hover:text-gray-700 dark:hover:text-gray-200"
            >
              {fromTeamData.full_name}
            </Link>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-gray-900 dark:text-gray-100">{memberName(member)}</span>
      </nav>

      {isAdmin && member.communications_banned === true && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">{tm('bannedBannerTitle')}</div>
            <div className="text-xs text-destructive/80">{tm('bannedBannerBody')}</div>
          </div>
        </div>
      )}

      {/* Profile card */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {/* Header section */}
        <div className="relative px-6 pb-5 pt-6">
          <div className="flex items-start gap-5">
            {/* Avatar */}
            {member.photo ? (
              <>
                <div className="relative shrink-0">
                  <img
                    src={getFileUrl('members', member.id, member.photo)}
                    alt={memberName(member)}
                    className="h-20 w-20 cursor-pointer rounded-full object-cover ring-2 ring-white sm:h-24 sm:w-24 dark:ring-gray-800"
                    onClick={() => setLightboxOpen(true)}
                  />
                  {member.number > 0 && (
                    <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white ring-2 ring-white dark:ring-gray-800">
                      {member.number}
                    </span>
                  )}
                </div>
                <ImageLightbox
                  src={getFileUrl('members', member.id, member.photo)}
                  alt={memberName(member)}
                  open={lightboxOpen}
                  onClose={() => setLightboxOpen(false)}
                />
              </>
            ) : (
              <div className="relative shrink-0">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-600 sm:h-24 sm:w-24 dark:bg-brand-900/40 dark:text-brand-300">
                  {initials}
                </div>
                {member.number > 0 && (
                  <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white ring-2 ring-white dark:ring-gray-800">
                    {member.number}
                  </span>
                )}
              </div>
            )}

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">
                  {memberName(member)}
                </h1>
                {member.role.map((r) => <StatusBadge key={r} status={r} />)}
              </div>

              {positions.length > 0 && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {positions.map((p) => (getPositionI18nKey(p) ? t(getPositionI18nKey(p)!) : p)).join(' · ')}
                </p>
              )}

              {/* Contact info — coach only */}
              {isCoach && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                  {member.birthdate_visibility !== 'hidden' && member.birthdate && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {t('age', { years: differenceInYears(new Date(), new Date(member.birthdate)) })}
                    </span>
                  )}
                  {!member.hide_email && member.email && (
                    <a href={`mailto:${member.email}`} className="inline-flex items-center gap-1.5 transition-colors hover:text-brand-500">
                      <Mail className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{member.email}</span>
                      <span className="sm:hidden">Email</span>
                    </a>
                  )}
                  {!member.hide_phone && member.phone && (
                    <a href={`tel:${member.phone}`} className="inline-flex items-center gap-1.5 transition-colors hover:text-brand-500">
                      <Phone className="h-3.5 w-3.5" />
                      {member.phone}
                    </a>
                  )}
                  {member.license_nr && (
                    <span className="inline-flex items-center gap-1.5">
                      <Award className="h-3.5 w-3.5" />
                      {member.license_nr}
                    </span>
                  )}
                </div>
              )}

              {/* Start DM entry point — self-hides when viewing own profile, feature flag off, or DMs disabled */}
              <div className="mt-3">
                <StartDmButton recipientId={String(member.id)} />
              </div>
            </div>
          </div>
        </div>

        {/* Teams row */}
        <div className="border-t border-gray-100 bg-gray-50 px-6 py-3 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex flex-wrap items-center gap-2">
            {memberTeams.map((mt) => {
              const teamObj = asObj<Team>(mt.team)
              return (
                <Link key={mt.id} to={`/teams/${teamObj?.name ?? (mt.team as string)}`}>
                  <TeamChip team={teamObj?.name ?? '?'} />
                </Link>
              )
            })}
            {memberTeams.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('noTeams')}</p>
            )}
          </div>
        </div>
      </div>

      {/* Statistics */}
      <div className="mt-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t('statistics')} ({season})
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label={t('trainingsAttended')}
            value={trainingStats ? `${trainingStats.present}/${trainingStats.total}` : '—'}
            sub={trainingPct !== null ? `${trainingPct}%` : undefined}
            icon={<TrendingUp className="h-4 w-4" />}
            color="brand"
          />
          <StatCard
            label={t('gamesAttended')}
            value={gameStats ? `${gameStats.present}/${gameStats.total}` : '—'}
            sub={gamePct !== null ? `${gamePct}%` : undefined}
            icon={<TrendingUp className="h-4 w-4" />}
            color="emerald"
          />
          <StatCard
            label={t('trainingRate')}
            value={trainingPct !== null ? `${trainingPct}%` : '—'}
            icon={<TrendingUp className="h-4 w-4" />}
            color="amber"
            highlight={trainingPct !== null && trainingPct < 50}
          />
          <StatCard
            label={currentlyAbsent ? t('currentlyAbsent') : soonAbsent ? t('soonAbsent') : t('activeAbsences')}
            value={currentlyAbsent ? t('absent') : soonAbsent ? t('upcoming') : String(absences.length)}
            icon={<AlertCircle className="h-4 w-4" />}
            color={currentlyAbsent ? 'red' : soonAbsent ? 'amber' : 'red'}
            highlight={currentlyAbsent}
          />
        </div>
      </div>

      {/* Active Absences */}
      {absences.length > 0 && (
        <div className="mt-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t('currentAbsences')}
          </h2>
          <div className="mt-3 space-y-2">
            {absences.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <StatusBadge status={a.reason} />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {formatDate(a.start_date)}
                  {a.start_date !== a.end_date && ` — ${formatDate(a.end_date)}`}
                </span>
                {a.reason_detail && (
                  <span className="text-sm text-gray-400">{a.reason_detail}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  color: 'brand' | 'emerald' | 'amber' | 'red'
  highlight?: boolean
}) {
  const iconColors = {
    brand: 'text-brand-500 bg-brand-50 dark:bg-brand-900/30 dark:text-brand-400',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400',
    red: 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400',
  }

  return (
    <div
      className={`rounded-lg border p-3 sm:p-4 ${
        highlight
          ? 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-900/10'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${iconColors[color]}`}>
          {icon}
        </span>
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <p className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{value}</p>
        {sub && (
          <span className="text-sm text-gray-400 dark:text-gray-500">{sub}</span>
        )}
      </div>
    </div>
  )
}
