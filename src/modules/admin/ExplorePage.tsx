// src/modules/admin/ExplorePage.tsx
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, ListTree, RefreshCw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { useExplorerCache } from './hooks/useExplorerCache'
import { getExplorerScope, type BucketKey } from './components/explorerHelpers'
import ExplorerSearch from './components/ExplorerSearch'
import ExplorerTree from './components/ExplorerTree'
import ExplorerDetail from './components/ExplorerDetail'
import ExplorerGrid from './components/ExplorerGrid'
import ExplorerMemberFilters, {
  EMPTY_FILTERS,
  applyMemberFilters,
  type MemberFilterState,
} from './components/ExplorerMemberFilters'

const VALID_TYPES: readonly BucketKey[] = ['members', 'teams', 'events', 'trainings', 'games']

type ExplorerView = 'tree' | 'grid'
const VIEW_LS_KEY = 'kscw-explorer-view'

function storedView(): ExplorerView {
  try { return localStorage.getItem(VIEW_LS_KEY) === 'grid' ? 'grid' : 'tree' } catch { return 'tree' }
}

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
  const { data, isLoading, error, refresh, mutate } = useExplorerCache(scope)

  // Grid editing gate: global admins + sport admins. The Vorstand policy is
  // read-only on members/member_teams at the Directus layer, so it gets a
  // read-only grid (writes would 403 anyway).
  const canEditGrid = auth.isGlobalAdmin || auth.isVbAdmin || auth.isBbAdmin

  // Report to the app boot gate — see usePageReady.tsx. Only the initial load
  // (before any cache lands) holds the boot spinner; refreshes keep the page
  // visible and use the inline refresh state.
  useReportPageLoading(isLoading && !data.loadedAt)

  const [params, setParams] = useSearchParams()
  const rawType = params.get('t')
  const rawId = params.get('id')
  const selectedType = (VALID_TYPES as readonly string[]).includes(rawType ?? '')
    ? (rawType as BucketKey)
    : null
  const selectedId = rawId && /^[\w-]+$/.test(rawId) ? rawId : null

  // View mode: explicit ?v= wins, otherwise the last choice from localStorage.
  const rawView = params.get('v')
  const view: ExplorerView = rawView === 'grid' || rawView === 'tree' ? rawView : storedView()

  const setView = useCallback((next: ExplorerView) => {
    try { localStorage.setItem(VIEW_LS_KEY, next) } catch { /* quota — non-fatal */ }
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('v', next)
      return p
    }, { replace: false })
  }, [setParams])

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
      setParams({ t: type, id, v: 'tree' }, { replace: false })
    },
    [setParams],
  )

  const handleBackToTree = useCallback(() => {
    setParams({ v: 'tree' }, { replace: false })
  }, [setParams])

  // Grid row → full detail view (tree mode with the member selected).
  const handleOpenDetail = useCallback(
    (memberId: string) => {
      setParams({ t: 'members', id: memberId, v: 'tree' }, { replace: false })
    },
    [setParams],
  )

  const handleRefresh = useCallback(() => {
    void refresh()
  }, [refresh])

  const hasSelection = !!selectedType && !!selectedId
  const refreshedAt = data.loadedAt ? new Date(data.loadedAt).toLocaleTimeString('de-CH', { hour12: false }) : null

  return (
    // Mobile: natural height — one scroll context (Layout's <main>), no nested
    // scroller to trap touch gestures or hide content behind the bottom tab bar.
    // md+: Layout renders this route full-bleed (main is overflow-hidden flex),
    // so h-full + min-h-0 fills the viewport exactly — internal scrolling only.
    <div className="flex flex-col bg-background text-foreground md:min-h-0 md:flex-1 md:h-full">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 md:px-4">
        <h1 className="hidden text-sm font-bold text-primary md:block">{t('explorerTitle')}</h1>
        <div className="max-w-md flex-1">
          <ExplorerSearch value={query} onChange={setQuery} />
        </div>
        <ExplorerMemberFilters value={memberFilters} onChange={setMemberFilters} />
        {/* Tree / grid view toggle */}
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label={t('explorerViewToggle')}>
          <button
            type="button"
            onClick={() => setView('tree')}
            className={
              'inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium ' +
              (view === 'tree' ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted')
            }
            title={t('explorerViewTree')}
            aria-pressed={view === 'tree'}
          >
            <ListTree className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t('explorerViewTree')}</span>
          </button>
          <button
            type="button"
            onClick={() => setView('grid')}
            className={
              'inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium ' +
              (view === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted')
            }
            title={t('explorerViewGrid')}
            aria-pressed={view === 'grid'}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{t('explorerViewGrid')}</span>
          </button>
        </div>
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

      {/* Body — grid view */}
      {view === 'grid' && (
        isLoading && !data.loadedAt ? (
          <div className="p-4 text-sm text-muted-foreground">{t('explorerLoading')}</div>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">{t('explorerError')}</div>
        ) : (
          <ExplorerGrid
            cache={treeData}
            query={query}
            canEdit={canEditGrid}
            onOpenDetail={handleOpenDetail}
            onMutate={mutate}
          />
        )
      )}

      {/* Body — tree + detail view */}
      {view === 'tree' && (
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
      )}
    </div>
  )
}
