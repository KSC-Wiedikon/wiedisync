import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import { getLocale } from '../../../utils/dateUtils'
import { BellOff, Calendar, Users } from 'lucide-react'
import type { ConversationSummary } from '../api/types'
import { useMemberProfiles } from '../hooks/useMemberProfiles'
import { useTeamProfiles } from '../hooks/useTeamProfiles'
import Avatar from './Avatar'

type Props = { conversations: ConversationSummary[] }

export default function ConversationList({ conversations }: Props) {
  const { t, i18n } = useTranslation('messaging')
  // Localise the relative timestamps ("2 hours ago") to the active UI language —
  // date-fns defaults to English when no locale is passed.
  const dfnsLocale = getLocale(i18n.language)
  const memberIds = conversations.map(c => c.other_member).filter((x): x is string => !!x)
  const profiles = useMemberProfiles(memberIds)
  const teamIds = conversations.filter(c => c.type === 'team').map(c => c.team)
  const teams = useTeamProfiles(teamIds)

  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-background">
      {conversations.map((c) => {
        const isGroupDm = c.type === 'group_dm'
        const isActivityChat = c.type === 'activity_chat'
        const isTeam = c.type === 'team'
        const peer = c.other_member ? profiles.get(c.other_member) : undefined
        const teamProfile = isTeam && c.team ? teams.get(String(c.team)) : undefined
        const displayName = peer?.name
          ?? teamProfile?.name
          ?? (c.title ?? (isGroupDm ? t('groupChat.defaultName') : '—'))
        const rel = c.last_message_at
          ? formatDistanceToNowStrict(new Date(c.last_message_at), { addSuffix: true, locale: dfnsLocale })
          : ''
        return (
          <li key={c.id}>
            <Link
              to={`/inbox/${c.id}`}
              className="flex items-center gap-3 px-3 py-3 hover:bg-muted focus:bg-muted focus:outline-none"
            >
              {peer && (
                <Avatar src={peer.photo} alt={peer.name} size="md" />
              )}
              {teamProfile && (
                <Avatar src={teamProfile.picture} alt={teamProfile.name} size="md" />
              )}
              {isActivityChat && (
                <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  <Calendar
                    className="h-5 w-5"
                    aria-label={t('activityChat.label')}
                  />
                </div>
              )}
              {isGroupDm && (
                <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  <Users
                    className="h-5 w-5"
                    aria-label={t('groupChat.label')}
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm text-foreground">{displayName}</span>
                  {isActivityChat && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t('activityChat.badge')}
                    </span>
                  )}
                  {isGroupDm && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t('groupChat.badge')}
                    </span>
                  )}
                  {c.muted && <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-label={t('muted')} />}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.last_message_preview ?? t('inboxEmptyPreview')}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[11px] text-muted-foreground">{rel}</span>
                {c.unread_count > 0 && !c.muted && (
                  <span className="rounded-full bg-primary text-primary-foreground text-[10px] leading-none px-1.5 py-0.5 min-w-[18px] text-center">
                    {c.unread_count > 99 ? '99+' : c.unread_count}
                  </span>
                )}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
