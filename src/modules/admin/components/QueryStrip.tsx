import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../../hooks/useAuth'
import type { TemplateParam } from './TemplateParamForm'
import { fetchAllItems } from '../../../lib/api'

export interface QueryTemplate {
  id: string
  name: string
  query: string
  type: 'saved' | 'template'
  params: string // JSON string of TemplateParam[]
  owner: string
}

interface RecentQuery {
  query: string
  timestamp: number
}

interface QueryStripProps {
  onSelect: (query: string) => void
  onSelectTemplate: (template: QueryTemplate) => void
  currentUserId?: string
}

const RECENT_KEY = 'query-recent'

function parseParams(params: string): TemplateParam[] {
  try {
    const parsed = JSON.parse(params)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isParameterized(template: QueryTemplate): boolean {
  return parseParams(template.params).length > 0
}

/** Read the recent-query list out of localStorage. Same guards the old mount
 *  effect used: a missing key or unparseable payload yields an empty list. */
function readRecentQueries(): RecentQuery[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: RecentQuery[] = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, 20) : []
  } catch {
    return []
  }
}

export default function QueryStrip({ onSelect, onSelectTemplate }: QueryStripProps) {
  const { t } = useTranslation('admin')
  const { user } = useAuth()
  const userId = user?.id

  const [savedQueries, setSavedQueries] = useState<QueryTemplate[]>([])
  const [templates, setTemplates] = useState<QueryTemplate[]>([])
  // Lazy initialiser — localStorage is read once on mount, exactly like the
  // old mount effect did, but without the extra setState-in-effect render.
  const [recentQueries] = useState<RecentQuery[]>(readRecentQueries)

  // Fetch saved queries and templates from PB
  useEffect(() => {
    fetchAllItems<QueryTemplate>('query_templates', { sort: ['name'] })
      .then((records) => {
        const saved = records.filter(
          (r) => r.type === 'saved' && r.owner === userId,
        )
        const tmpl = records.filter((r) => r.type === 'template')
        setSavedQueries(saved)
        setTemplates(tmpl)
      })
      .catch(() => {
        setSavedQueries([])
        setTemplates([])
      })
  }, [userId])

  const handleSavedClick = (tmpl: QueryTemplate) => {
    onSelect(tmpl.query)
  }

  const handleTemplateClick = (tmpl: QueryTemplate) => {
    if (isParameterized(tmpl)) {
      onSelectTemplate(tmpl)
    } else {
      onSelect(tmpl.query)
    }
  }

  const handleRecentClick = (recent: RecentQuery) => {
    onSelect(recent.query)
  }

  const hasRow1 = savedQueries.length > 0 || templates.length > 0
  const hasRow2 = recentQueries.length > 0

  if (!hasRow1 && !hasRow2) return null

  return (
    <div className="flex flex-col gap-1.5 py-2">
      {/* Row 1: Saved + Templates */}
      {hasRow1 && (
        <div className="flex items-center gap-2 min-w-0">
          {savedQueries.length > 0 && (
            <>
              <span className="text-xs font-semibold text-brand-600 whitespace-nowrap shrink-0">
                {t('savedQueries')}
              </span>
              <div className="overflow-x-auto flex gap-2 items-center scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                {savedQueries.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handleSavedClick(tmpl)}
                    className="rounded-md px-3 py-1.5 text-xs cursor-pointer whitespace-nowrap hover:opacity-80 transition-opacity bg-gold-500/15 border border-gold-400/40 text-gold-700 dark:text-gold-300"
                  >
                    ⭐ {tmpl.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {savedQueries.length > 0 && templates.length > 0 && (
            <div className="w-px h-4 bg-border shrink-0" />
          )}

          {templates.length > 0 && (
            <>
              <span className="text-xs font-semibold text-brand-600 whitespace-nowrap shrink-0">
                {t('queryTemplates')}
              </span>
              <div className="overflow-x-auto flex gap-2 items-center scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handleTemplateClick(tmpl)}
                    className="rounded-md px-3 py-1.5 text-xs cursor-pointer whitespace-nowrap hover:opacity-80 transition-opacity bg-brand-600/10 border border-brand-600/30 text-brand-700 dark:text-brand-300"
                  >
                    📋 {tmpl.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Row 2: Recent queries */}
      {hasRow2 && (
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap shrink-0">
            {t('recentQueries')}
          </span>
          <div className="overflow-x-auto flex gap-2 items-center scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            {recentQueries.map((recent) => (
              <button
                key={recent.timestamp}
                type="button"
                onClick={() => handleRecentClick(recent)}
                title={recent.query}
                className="rounded-md px-3 py-1.5 text-xs cursor-pointer whitespace-nowrap hover:opacity-80 transition-opacity bg-muted border border-border text-muted-foreground font-mono max-w-[200px] truncate"
              >
                {recent.query}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
