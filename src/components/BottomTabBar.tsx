import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { Home, Calendar, Menu } from 'lucide-react'
import WhistleIcon from './WhistleIcon'

interface TabItem {
  to: string
  labelKey: string
  icon: React.ReactNode
  requiresAuth?: boolean
}

const iconClass = 'h-5 w-5'

/** Trainings tab glyph — kept as a named component (like WhistleIcon) so the tab
 * config stays free of inline path markup. */
function TrainingsIcon({ className = iconClass }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16.05 10.966a5 2.5 0 0 1-8.1 0" />
      <path d="m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04" />
      <path d="M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z" />
      <path d="M9.194 6.57a5 2.5 0 0 0 5.61 0" />
    </svg>
  )
}

const primaryTabs: TabItem[] = [
  { to: '/', labelKey: 'home', icon: <Home className={iconClass} /> },
  { to: '/calendar', labelKey: 'calendar', icon: <Calendar className={iconClass} /> },
  { to: '/games', labelKey: 'gamesShort', icon: <WhistleIcon className={iconClass} /> },
  { to: '/trainings', labelKey: 'trainings', requiresAuth: true, icon: <TrainingsIcon className={iconClass} /> },
]

interface BottomTabBarProps {
  onMoreTap: () => void
  moreActive: boolean
  unreadNotifications?: number
}

export default function BottomTabBar({ onMoreTap, moreActive, unreadNotifications = 0 }: BottomTabBarProps) {
  const { t } = useTranslation('nav')
  const { t: tn } = useTranslation('notifications')
  const { user, isApproved } = useAuth()
  const visibleTabs = primaryTabs.filter((tab) => !tab.requiresAuth || (user && isApproved))
  return (
    <nav data-system-bar="bottom" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-stretch gap-1.5 px-2 py-2">
        {visibleTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex h-14 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? 'bg-selected text-selected-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`
            }
          >
            {tab.icon}
            {t(tab.labelKey)}
          </NavLink>
        ))}

        {/* More tab */}
        <button
          onClick={onMoreTap}
          className={`relative flex h-14 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            moreActive
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          <Menu className={iconClass} />
          {unreadNotifications > 0 && (
            <span className="absolute left-1/2 top-2 ml-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-card">
              <span className="sr-only">{tn('unreadBadge', { count: unreadNotifications })}</span>
            </span>
          )}
          {t('more')}
        </button>
      </div>
    </nav>
  )
}
