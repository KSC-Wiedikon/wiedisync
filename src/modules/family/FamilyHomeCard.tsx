import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { accentOf } from '../../components/householdAccents'
import HouseholdAvatar from '../../components/HouseholdAvatar'

/**
 * Home entry to the family view, for a main account with linked members. Pure
 * link — no fetch on Home; the agenda loads on /family.
 */
export default function FamilyHomeCard() {
  const { t } = useTranslation('home')
  const { householdMembers, isActingForOther } = useAuth()
  if (isActingForOther || householdMembers.length === 0) return null
  const names = householdMembers.map((m) => m.first_name || m.last_name).filter(Boolean).join(', ')

  return (
    <Link
      to="/family"
      className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-hairline bg-card px-4 py-3 shadow-card transition-colors hover:bg-muted dark:hover:bg-white/5"
    >
      <span className="flex shrink-0 -space-x-2">
        {householdMembers.slice(0, 4).map((m) => (
          <HouseholdAvatar key={m.id} photo={m.photo} name={m.first_name || ''} accent={accentOf(m.accent)} size="sm" className="ring-2 ring-card" />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground">{t('familyTitle')}</span>
        <span className="block break-words text-sm text-muted-foreground">{t('familyHomeCard', { names })}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  )
}
