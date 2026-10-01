import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueries } from '@tanstack/react-query'
import { CalendarDays, MapPin, Users } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { ActivityRow, DateRail, RowChip, RowList, TeamPair } from '@/components/ActivityRow'
import type { RowTone } from '@/components/activityRowTokens'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { accentOf } from '../../components/householdAccents'
import HouseholdAvatar from '../../components/HouseholdAvatar'
import { formatDayMonthZurich, formatWeekdayZurich, todayLocal } from '../../utils/dateHelpers'
import FamilyRsvp from './FamilyRsvp'
import { loadFamilyAgenda, type FamilyItem, type FamilyPerson } from './familyAgenda'

const STATUS_TONE: Record<string, RowTone> = { confirmed: 'green', tentative: 'amber', declined: 'red' }

/**
 * Family view — every linked member's next three weeks on one page, answered
 * in place. The parent stays herself: each read and write carries the child's
 * acting header (see familyAgenda.ts), so nothing here switches the app.
 */
export default function FamilyPage() {
  const { t } = useTranslation('home')
  const navigate = useNavigate()
  const { householdMembers, isActingForOther, actingMember, switchTo } = useAuth()
  const [only, setOnly] = useState<string | null>(null)
  const [openOnly, setOpenOnly] = useState(false)
  const today = todayLocal()

  const people = useMemo<FamilyPerson[]>(() => householdMembers.map((m) => ({
    memberId: String(m.id),
    actAs: Number(m.id),
    firstName: m.first_name || m.last_name || '',
    name: [m.first_name, m.last_name].filter(Boolean).join(' '),
    photo: m.photo,
    accent: m.accent,
  })), [householdMembers])

  const results = useQueries({
    queries: people.map((p) => ({
      queryKey: ['family-agenda', p.memberId, today],
      queryFn: () => loadFamilyAgenda(p, today),
      enabled: !isActingForOther,
      staleTime: 30_000,
    })),
  })
  const loading = !isActingForOther && results.some((r) => r.isLoading)
  useReportPageLoading(loading)

  const items = useMemo(() => {
    const all: FamilyItem[] = results.flatMap((r) => r.data ?? [])
    all.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.person.firstName.localeCompare(b.person.firstName))
    return all
  }, [results])

  const isOpen = (it: FamilyItem) => !it.excluded && !it.mine
  const openCount = items.filter(isOpen).length
  const shown = items.filter((it) => (!only || it.person.memberId === only) && (!openOnly || isOpen(it)))
  const refetchFor = (memberId: string) => {
    const i = people.findIndex((p) => p.memberId === memberId)
    if (i >= 0) void results[i]?.refetch()
  }

  async function openAs(item: FamilyItem) {
    await switchTo(item.person.actAs)
    navigate(`/events/${item.id}`)
  }

  const header = (
    <div>
      <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('familyTitle')}</h1>
      <p className="mt-1 text-muted-foreground">{t('familySubtitle')}</p>
    </div>
  )

  if (isActingForOther) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-2xl border border-hairline bg-card p-4 shadow-card">
          <p className="text-sm text-foreground">{t('familyActing', { name: actingMember?.first_name ?? '' })}</p>
          <Button type="button" className="mt-3" onClick={() => { void switchTo(null) }}>{t('familyBackToMe')}</Button>
        </div>
      </div>
    )
  }

  if (people.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <p className="rounded-2xl border border-hairline bg-card p-4 text-sm text-muted-foreground shadow-card">{t('familyNoMembers')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {header}

      {/* Who + what: one chip per member, plus "Unanswered only". */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOnly(null)}
          aria-pressed={only === null}
          className={cn(only === null && 'bg-selected text-selected-foreground')}
        >
          <Users aria-hidden />
          {t('familyAll')}
        </Button>
        {people.map((p) => (
          <Button
            key={p.memberId}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOnly(only === p.memberId ? null : p.memberId)}
            aria-pressed={only === p.memberId}
            className={cn('gap-1.5', only === p.memberId && 'bg-selected text-selected-foreground')}
          >
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', accentOf(p.accent).dot)} aria-hidden />
            {p.firstName}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpenOnly((v) => !v)}
          aria-pressed={openOnly}
          className={cn(openOnly && 'bg-selected text-selected-foreground')}
        >
          {t('familyUnansweredOnly')}
          <span className="tabular-nums">({openCount})</span>
        </Button>
      </div>

      {results.map((r, i) => r.isError ? (
        <p key={people[i].memberId} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {t('familyLoadError', { name: people[i].firstName })}
        </p>
      ) : null)}

      <div className="rounded-2xl border border-hairline bg-card px-1 shadow-card sm:px-2">
        {!loading && shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('familyEmpty')}</p>
        ) : (
          <RowList>
            {shown.map((it) => {
              const tone: RowTone = it.excluded ? 'gray' : STATUS_TONE[it.mine?.status ?? ''] ?? 'gray'
              const accent = accentOf(it.person.accent)
              return (
                <ActivityRow
                  key={it.key}
                  tone={tone}
                  muted={it.excluded}
                  rail={
                    <DateRail
                      tone={tone}
                      eyebrow={formatWeekdayZurich(it.date)}
                      main={formatDayMonthZurich(it.date)}
                      sub={it.time || undefined}
                    />
                  }
                  title={it.kind === 'game' && it.home ? (
                    <TeamPair home={it.home} away={it.away ?? ''} emphasis={it.emphasis} />
                  ) : (
                    <span className="break-words font-semibold text-foreground">
                      {it.kind === 'training' ? `${t('familyTraining')} ${it.title}` : it.title}
                    </span>
                  )}
                  chips={<>
                    <RowChip>
                      <HouseholdAvatar photo={it.person.photo} name={it.person.firstName} accent={accent} size="sm" className="-my-1 h-4 w-4 text-[9px]" />
                      {it.person.firstName}
                    </RowChip>
                    {it.teamName && it.kind !== 'training' && <RowChip>{it.teamName}</RowChip>}
                    {it.kind === 'event' && <RowChip><CalendarDays aria-hidden />{t('events')}</RowChip>}
                    {it.place && <RowChip wrap title={it.place}><MapPin aria-hidden />{it.place}</RowChip>}
                  </>}
                  tools={it.perDay && !it.excluded ? (
                    <Button type="button" size="tool" variant="outline" onClick={() => { void openAs(it) }}>
                      {t('familyAnswerPerDay', { name: it.person.firstName })}
                    </Button>
                  ) : undefined}
                >
                  {!it.perDay && (
                    <div className="mt-2.5">
                      <FamilyRsvp item={it} onSaved={() => refetchFor(it.person.memberId)} />
                    </div>
                  )}
                </ActivityRow>
              )
            })}
          </RowList>
        )}
      </div>
    </div>
  )
}
