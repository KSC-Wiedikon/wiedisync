// src/modules/admin/ExplorePage.tsx
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { currentLocale } from '../../utils/dateHelpers'
import { useAuth } from '../../hooks/useAuth'
import { useExplorerCache } from './hooks/useExplorerCache'
import { getExplorerScope, type BucketKey } from './components/explorerHelpers'
import ExplorerSearch from './components/ExplorerSearch'
import ExplorerTree from './components/ExplorerTree'
import ExplorerDetail from './components/ExplorerDetail'
import ExplorerMemberFilters, {
  EMPTY_FILTERS,
  applyMemberFilters,
  type MemberFilterState,
} from './components/ExplorerMemberFilters'

const VALID_TYPES: readonly BucketKey[] = ['members', 'teams', 'events', 'trainings', 'games']

export default function ExplorePage() {
  const { t } = useTranslation('admin')
  const auth = useAuth()
  const scope = useMemo(
    () => getExplorerScope({
      isGlobalAdmin: auth.isGlobalAdmin,
      isVorstand: auth.isVorstand,
      isVbAdmin: auth.isVbAdmin,
      isBbAdmin: auth.isBbAdmin,
    }),
    [auth.isGlobalAdmin, auth.isVorstand, auth.isVbAdmin, auth.isBbAdmin],
  )
  const { data, isLoading, error, refresh } = useExplorerCache(scope)

  const [params, setParams] = useSearchParams()
  const rawType = params.get('t')
  const rawId = params.get('id')
  const selectedType = (VALID_TYPES as readonly string[]).includes(rawType ?? '')
    ? (rawType as BucketKey)
    : null
  const selectedId = rawId && /^[\w-]+$/.test(rawId) ? rawId : null

  const [query, setQuery] = useState('')
  const [memberFilters, setMemberFilters] = useState<MemberFilterState>(EMPTY_FILTERS)

  // Apply member filters client-side to the cached members list. Tree receives
  // filtered cache (so member counts/listing narrow); detail view keeps the
  // unfiltered cache so navigations from teams/games to filtered-out members
  // still resolve. memberTeams/coach/tr Maps are unchanged.
  const treeData = useMemo(
    () => ({ ...data, members: applyMemberFilters(data.members, memberFilters, data) }),
    [data, memberFilters],
  )

  const handleSelect = useCallback(
    (type: BucketKey, id: string) => {
      setParams({ t: type, id }, { replace: false })
    },
    [setParams],
  )

  const handleBackToTree = useCallback(() => {
    setParams({}, { replace: false })
  }, [setParams])

  const handleRefresh = useCallback(() => {
    void refresh()
  }, [refresh])

  const hasSelection = !!selectedType && !!selectedId
  const refreshedAt = data.loadedAt ? new Date(data.loadedAt).toLocaleTimeString(currentLocale(), { hour12: false }) : null

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 md:px-4">
        <h1 className="hidden text-sm font-bold text-primary md:block">{t('explorerTitle')}</h1>
        <div className="max-w-md flex-1">
          <ExplorerSearch value={query} onChange={setQuery} />
        </div>
        <ExplorerMemberFilters value={memberFilters} onChange={setMemberFilters} />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          title={refreshedAt ? t('explorerRefreshedAt', { time: refreshedAt }) : undefined}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{t('explorerRefresh')}</span>
        </button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {/* Tree — hidden on mobile when a detail is open */}
        <aside
          className={
            'w-full overflow-hidden border-r border-border bg-card md:w-[280px] md:flex-shrink-0 ' +
            (hasSelection ? 'hidden md:block' : 'block')
          }
        >
          {isLoading && !data.loadedAt ? (
            <div className="p-4 text-sm text-muted-foreground">{t('explorerLoading')}</div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">{t('explorerError')}</div>
          ) : (
            <ExplorerTree
              cache={treeData}
              selectedType={selectedType}
              selectedId={selectedId}
              query={query}
              onSelect={handleSelect}
            />
          )}
        </aside>

        {/* Detail */}
        <main
          className={
            'min-w-0 flex-1 bg-background ' +
            (hasSelection ? 'block' : 'hidden md:block')
          }
        >
          <ExplorerDetail
            cache={data}
            type={selectedType}
            id={selectedId}
            onSelect={handleSelect}
            onBack={handleBackToTree}
          />
        </main>
      </div>
    </div>
  )
}
