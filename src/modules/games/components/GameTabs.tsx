import { useTranslation } from 'react-i18next'

export type TabKey = 'upcoming' | 'results' | 'rankings' | 'scoreboard' | 'dashboard'

const TAB_LABELS: Record<TabKey, string> = {
  upcoming: 'tabUpcoming',
  results: 'tabResults',
  rankings: 'tabRankings',
  scoreboard: 'tabScoreboard',
  dashboard: 'tabDashboard',
}

const DEFAULT_TABS: TabKey[] = ['upcoming', 'results', 'rankings', 'scoreboard']

interface GameTabsProps {
  activeTab: TabKey
  onChange: (tab: TabKey) => void
  /** Visible tab keys (default: upcoming/results/rankings/scoreboard). */
  tabs?: TabKey[]
}

export default function GameTabs({ activeTab, onChange, tabs = DEFAULT_TABS }: GameTabsProps) {
  const { t } = useTranslation('games')

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors sm:py-2.5 ${
            activeTab === tab
              ? 'border-gold-400 text-brand-700 dark:text-gold-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {t(TAB_LABELS[tab])}
        </button>
      ))}
    </div>
  )
}
