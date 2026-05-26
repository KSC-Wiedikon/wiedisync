import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import TeamChip from '../../components/TeamChip'
import { getTeamColor, trimBBTeamName } from '../../utils/teamColors'
import { getFileUrl } from '../../utils/fileUrl'
import type { Team } from '../../types'

interface TeamCardProps {
  team: Team
  playerCount: number
  guestCount: number
}

export default function TeamCard({ team, playerCount, guestCount }: TeamCardProps) {
  const { t } = useTranslation('teams')
  return (
    <Link
      to={`/teams/${team.name}`}
      className="relative block overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-card transition-shadow hover:shadow-card-hover"
      style={{ borderLeftWidth: '4px', borderLeftColor: getTeamColor(team.name).bg }}
    >
      {team.team_picture && (() => {
        const parts = team.team_picture_pos?.split(' ').map((v) => parseFloat(v)) ?? []
        const posX = !isNaN(parts[0]) ? parts[0] : 50
        const posY = !isNaN(parts[1]) ? parts[1] : 50
        const z = parts.length >= 3 && !isNaN(parts[2]) ? parts[2] : 1
        return (
          <img
            src={getFileUrl('teams', team.id, team.team_picture)}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-10"
            style={{
              objectPosition: `${posX}% ${posY}%`,
              transform: z !== 1 ? `scale(${z})` : undefined,
              transformOrigin: `${posX}% ${posY}%`,
            }}
          />
        )
      })()}
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <TeamChip team={team.name} />
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{trimBBTeamName(team.full_name)}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span>{team.league}</span>
          <span>{team.season}</span>
          <span>{t('players', { count: playerCount })}</span>
          {guestCount > 0 && <span>{t('guests', { count: guestCount })}</span>}
        </div>
      </div>
    </Link>
  )
}
