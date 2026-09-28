import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/button'
import { useConfirm } from '../../../components/ConfirmProvider'
import type { TeamLink } from '../../../types'
import type { LinkType } from '../hooks/useTeamLinks'

interface EditorTeam {
  id: string | number
  name: string
}

interface Props {
  teams: EditorTeam[]
  links: TeamLink[]
  addLink: (teamA: string | number, teamB: string | number, linkType: LinkType) => Promise<void>
  updateLink: (id: string | number, linkType: LinkType) => Promise<void>
  removeLink: (id: string | number) => Promise<void>
}

/**
 * Sport-agnostic editor for coach/player-sharing team links (migration 218).
 * Shared by the Basketball prep Settings and the volleyball Terminplanung Settings.
 * "Add" upserts by pair (see useTeamLinks); each existing link has an inline type
 * dropdown so its type can be changed in place.
 */
export default function TeamLinksEditor({ teams, links, addLink, updateLink, removeLink }: Props) {
  const { t } = useTranslation('teamLinks')
  const confirm = useConfirm()

  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [linkType, setLinkType] = useState<LinkType>('diff')

  const teamName = (id: string | number) => teams.find((tm) => String(tm.id) === String(id))?.name ?? `#${id}`
  const selectClass = 'h-11 rounded-lg border border-input bg-card px-3 py-2 text-sm sm:h-9 dark:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const badge = (lt: string) =>
    lt === 'same'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : lt === 'adjacent'
        ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'

  async function add() {
    if (!teamA || !teamB || teamA === teamB) return
    try {
      await addLink(teamA, teamB, linkType)
      setTeamA('')
      setTeamB('')
    } catch {
      toast.error(t('saveError'))
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{t('title')}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('hint')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <select className={selectClass} value={teamA} onChange={(e) => setTeamA(e.target.value)}>
          <option value="">{t('teamA')}</option>
          {teams.map((tm) => (
            <option key={tm.id} value={tm.id}>{tm.name}</option>
          ))}
        </select>
        <select className={selectClass} value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)}>
          <option value="diff">{t('linkDiff')}</option>
          <option value="adjacent">{t('linkAdjacent')}</option>
          <option value="same">{t('linkSame')}</option>
        </select>
        <select className={selectClass} value={teamB} onChange={(e) => setTeamB(e.target.value)}>
          <option value="">{t('teamB')}</option>
          {teams.map((tm) => (
            <option key={tm.id} value={tm.id}>{tm.name}</option>
          ))}
        </select>
        <Button onClick={add} disabled={!teamA || !teamB || teamA === teamB}>{t('add')}</Button>
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-sm">
              <select
                className={`rounded border-0 px-2 py-0.5 text-xs font-medium ${badge(l.link_type)}`}
                value={l.link_type}
                onChange={async (e) => {
                  try {
                    await updateLink(l.id, e.target.value as LinkType)
                  } catch {
                    toast.error(t('saveError'))
                  }
                }}
                aria-label={t('title')}
              >
                <option value="diff">{t('linkDiff')}</option>
                <option value="adjacent">{t('linkAdjacent')}</option>
                <option value="same">{t('linkSame')}</option>
              </select>
              <span>{teamName(l.team_a)} ↔ {teamName(l.team_b)}</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="ml-auto px-0 text-xs text-rose-600 dark:text-rose-400"
                onClick={async () => {
                  if (!(await confirm({ message: `${teamName(l.team_a)} ↔ ${teamName(l.team_b)}`, danger: true }))) return
                  await removeLink(l.id)
                }}
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
