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
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-2.5 ${
            activeTab === tab
              ? 'border-foreground font-semibold text-foreground'
              : 'border-transparent text-muted-foreground hover:border-input hover:text-foreground'
          }`}
        >
          {t(TAB_LABELS[tab])}
        </button>
      ))}
    </div>
  )
}
