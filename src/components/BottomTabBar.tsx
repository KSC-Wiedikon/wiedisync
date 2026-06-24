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

const iconClass = 'h-6 w-6'

const primaryTabs: TabItem[] = [
  { to: '/', labelKey: 'home', icon: <Home className={iconClass} /> },
  { to: '/calendar', labelKey: 'calendar', icon: <Calendar className={iconClass} /> },
  { to: '/games', labelKey: 'gamesShort', icon: <WhistleIcon className={iconClass} /> },
  { to: '/trainings', labelKey: 'trainings', requiresAuth: true, icon: (
    <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16.05 10.966a5 2.5 0 0 1-8.1 0" />
      <path d="m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04" />
      <path d="M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z" />
      <path d="M9.194 6.57a5 2.5 0 0 0 5.61 0" />
    </svg>
  ) },
]

interface BottomTabBarProps {
  onMoreTap: () => void
  moreActive: boolean
  unreadNotifications?: number
}

export default function BottomTabBar({ onMoreTap, moreActive, unreadNotifications = 0 }: BottomTabBarProps) {
  const { t } = useTranslation('nav')
  const { user, isApproved } = useAuth()
  const visibleTabs = primaryTabs.filter((tab) => !tab.requiresAuth || (user && isApproved))
  return (
    <nav data-tour="nav-sidebar" className="pb-safe fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex h-16 items-stretch">
        {visibleTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                isActive
                  ? 'text-gold-500 dark:text-gold-400'
                  : 'text-gray-500 dark:text-gray-400'
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
          className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            moreActive
              ? 'text-gold-500 dark:text-gold-400'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <Menu className={iconClass} />
          {unreadNotifications > 0 && (
            <span className="absolute right-2.5 top-1 h-2 w-2 rounded-full bg-red-500" />
          )}
          {t('more')}
        </button>
      </div>
    </nav>
  )
}
