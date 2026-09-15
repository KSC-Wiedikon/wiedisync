import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, Loader2, Sparkles } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { Badge } from '../../components/ui/badge'
import { usePlatform } from './install/usePlatform'

/**
 * The personal head of the guide: who the reader is in the club (their roles
 * and teams, read live from the auth context) and a getting-started checklist
 * whose ticks come from real state — the app installed, push on, profile
 * complete, photo set, IBAN confirmed — each with the action that completes it.
 */
export default function GuideStart({ onInstall }: { onInstall: () => void }) {
  const { t } = useTranslation('guide')
  const auth = useAuth()
  const platform = usePlatform()
  const push = usePushNotifications()
  const { user } = auth

  const roles = useMemo(() => {
    const out: ReactNode[] = []
    if (auth.memberTeamNames.length > 0) out.push(t('start.roles.player', { teams: auth.memberTeamNames.join(', ') }))
    if (auth.coachTeamNames.length > 0) out.push(t('start.roles.coach', { teams: auth.coachTeamNames.join(', ') }))
    else if (auth.teamResponsibleIds.length > 0) out.push(t('start.roles.tr'))
    if (auth.captainTeamIds.length > 0) out.push(t('start.roles.captain'))
    if (auth.is_spielplaner) out.push(t('start.roles.spielplaner'))
    if (auth.canAccessFinance) out.push(t('start.roles.finance'))
    if (auth.isVorstand) out.push(t('start.roles.vorstand'))
    if (auth.isSuperAdmin) out.push(t('start.roles.superadmin'))
    else if (auth.isAdmin) out.push(t('start.roles.admin'))
    if (out.length === 0) out.push(t('start.roles.member'))
    return out
  }, [auth, t])

  if (!user) return null

  const installed = platform === 'standalone'
  const items: Array<{ key: string; done: boolean; pending?: boolean; action: ReactNode }> = [
    {
      key: 'install',
      done: installed,
      action: platform === 'desktop'
        ? <span className="text-xs text-muted-foreground">{t('start.items.installDesktop')}</span>
        : <ActionButton onClick={onInstall}>{t('start.actions.showHow')}</ActionButton>,
    },
    {
      key: 'push',
      done: push.subscribed,
      pending: push.probing,
      action: !push.supported
        ? <span className="text-xs text-muted-foreground">{t('start.items.pushUnsupported')}</span>
        : push.permission === 'denied'
          ? <span className="text-xs text-muted-foreground">{t('start.items.pushDenied')}</span>
          : <ActionButton onClick={() => { void push.subscribe() }}>{t('start.actions.turnOn')}</ActionButton>,
    },
    {
      key: 'profile',
      done: auth.isProfileComplete,
      action: <ActionLink to="/profile">{t('start.actions.open')}</ActionLink>,
    },
    {
      key: 'photo',
      done: !!user.photo,
      action: <ActionLink to="/profile">{t('start.actions.open')}</ActionLink>,
    },
    {
      key: 'iban',
      done: !!user.iban && user.iban_confirmed !== false,
      action: <ActionLink to="/finance/dues">{t('start.actions.open')}</ActionLink>,
    },
  ]
  const done = items.filter((i) => i.done).length

  return (
    <section className="rounded-xl border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary shrink-0" />
        <h2 className="text-sm font-semibold text-foreground">{t('start.title')}</h2>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t('start.rolesTitle')}</p>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r, i) => <Badge key={i} variant="secondary" className="text-xs font-medium">{r}</Badge>)}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('start.checklistTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('start.progress', { done, total: items.length })}</p>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 px-3 py-2.5 min-h-[44px]">
              {item.pending
                ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                : item.done
                  ? <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-500" />
                  : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
              <span className={`flex-1 text-sm ${item.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {t(`start.items.${item.key}`)}
              </span>
              {!item.done && !item.pending && item.action}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const actionCls = 'inline-flex min-h-[44px] sm:min-h-[36px] items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted/60'

function ActionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={actionCls}>{children}</button>
}

function ActionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className={actionCls}>{children}</Link>
}
