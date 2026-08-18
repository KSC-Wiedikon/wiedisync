import { useCallback, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, CheckCircle2, Clock, HelpCircle, Search, ShieldCheck, X } from 'lucide-react'
import { cn } from '../../../../lib/utils'
import { badgeVariants } from '../../../../components/ui/badge'
import { Input } from '../../../../components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../../../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs'
import { groupRows } from '../utils/cohorts'
import { prettyFederationName, splitEmails } from '../utils/federationText'
import {
  ROW_STATE_BADGE_VARIANT, ROW_STATE_LABEL_KEY, applyWorklistFilters,
} from '../utils/rowState'
import { AboutNumbersPanel } from './AboutNumbersPanel'
import { CopyButton } from './CopyButton'
import { TransferGroupTable } from './TransferGroupTable'
import type {
  CohortTab, FooConflict, GroupBy, RowState, TransferCohorts,
  TransferDerivations, TransferGroup, TransferMember, TransferRowActions,
} from '../types'

/**
 * Keep only the rows of `groups` that survived a filter, dropping groups that
 * end up empty.
 *
 * ⚠ Deliberately NOT a re-grouping. The federation key/label pair is built once
 * in `useTransferData` (`groupRows` + `federationDisplay(code, SPORT)`) and this
 * page must not own a second copy of it: two definitions of "which federation is
 * this group" is exactly how a filtered worklist starts labelling a group
 * differently from the unfiltered one. Narrowing also keeps the group ORDER
 * stable while somebody types, instead of resorting the cards under the cursor
 * on every keystroke.
 */
function narrowToRows(groups: readonly TransferGroup[], rows: readonly TransferMember[]): TransferGroup[] {
  const keep = new Set(rows.map((m) => String(m.id)))
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter((m) => keep.has(String(m.id))) }))
    .filter((g) => g.rows.length > 0)
}

/**
 * The five cohorts as tabs, plus the worklist toolbar.
 *
 * ⚠⚠ Inactive `<TabsContent>` UNMOUNTS — no `forceMount` anywhere in this file.
 * That is the whole point of the tab strip: the Swiss cohort is ~483 rows and a
 * cold page load must not pay for a table nobody asked for. (Its group is
 * collapsed on top of that, so opening the tab still mounts nothing until the
 * header is clicked — see `TransferGroupTable`.)
 *
 * ⚠ Every cohort keeps a tab AND a count, even at 0. The counts are what keep
 * "nobody needs a transfer" and "everybody was ruled out" distinguishable — the
 * requirement the original met by rendering the "no transfer needed" section
 * OUTSIDE its empty-state branch. The empty state therefore lives INSIDE the
 * worklist tab and speaks only for it, while 'Ruled out (12)' and
 * 'Swiss Volley (483)' stay legible next to it.
 *
 * ⚠ The Diagnostics tab count carries the register disagreements ONLY. It is
 * deliberately NOT summed with the four hidden tallies: "people this page left
 * out" and "registers that contradict each other" are different quantities, and
 * one number covering both answers neither. The hidden total stays countable
 * from outside on its own line under the page header (`trHiddenSummary` in
 * `TransfersHeader`), which is what keeps a filter from swallowing a transfer
 * silently.
 */
export function TransferCohortTabs({
  activeTab,
  onTabChange,
  cohorts,
  conflicts,
  needsGroups,
  clarifyGroups,
  swissGroups,
  notNeededGroups,
  search,
  onSearchChange,
  groupBy,
  onGroupByChange,
  stateFilter,
  onStateFilterChange,
  derivations,
  actions,
  openGroups,
  onGroupOpenChange,
  diagnostics,
}: {
  activeTab: CohortTab
  onTabChange: (t: CohortTab) => void
  cohorts: TransferCohorts
  conflicts: readonly FooConflict[]
  needsGroups: TransferGroup[]
  clarifyGroups: TransferGroup[]
  swissGroups: TransferGroup[]
  notNeededGroups: TransferGroup[]
  search: string
  onSearchChange: (v: string) => void
  groupBy: GroupBy
  onGroupByChange: (g: GroupBy) => void
  stateFilter: RowState | null
  onStateFilterChange: (s: RowState | null) => void
  derivations: TransferDerivations
  actions: TransferRowActions
  openGroups: ReadonlySet<string>
  onGroupOpenChange: (key: string, open: boolean) => void
  diagnostics: ReactNode
}) {
  const { t } = useTranslation('admin')
  const { stateOf } = derivations

  /**
   * One state's label, from the SAME key the State column and the filter chips
   * use, so the three surfaces can never drift.
   *
   * ⚠ `trStateInProgress` carries VIS's own per-row progress figure
   * (`In progress {{percent}}%`). A group heading covers many rows and has no
   * single percentage to state, so the interpolation is fed an empty string and
   * the stray `%` dropped — never a `0%` VIS never reported. Same treatment as
   * `TransferNumbersBar`'s chips.
   */
  const stateLabel = useCallback((state: RowState) => (
    state === 'inProgress'
      ? t(ROW_STATE_LABEL_KEY[state], { percent: '' }).replace(/\s*%/, '').trim()
      : t(ROW_STATE_LABEL_KEY[state])
  ), [t])

  // ── Worklist ──────────────────────────────────────────────────────
  // Search AND the state chips, over `cohorts.needs` only. `applyWorklistFilters`
  // is pure and injects `stateOf` rather than recomputing it, so a keystroke does
  // not re-derive the VIS-transfer index for every row.
  const visibleNeedsGroups = useMemo(() => {
    const rows = applyWorklistFilters(cohorts.needs, { search, state: stateFilter }, stateOf)
    if (groupBy === 'none') return groupRows(rows, () => '', () => '')
    // Grouped by the derived state: a group is then NOT a federation, so it gets
    // the plain heading `TransferGroupTable` renders for that case — no contact
    // line and no prepared letter, which would address one federation on behalf
    // of members licensed by several.
    if (groupBy === 'state') return groupRows(rows, stateOf, (key) => stateLabel(key as RowState))
    return narrowToRows(needsGroups, rows)
  }, [cohorts.needs, needsGroups, search, stateFilter, groupBy, stateOf, stateLabel])

  /**
   * Search on "Ruled out" and on the Swiss list too — state has no meaning in
   * either (they are one derived state by construction), but "is this person in
   * there?" is a real question against 483 rows, and the same pure filter answers
   * it for all three tabs.
   */
  const visibleNotNeededGroups = useMemo(
    () => narrowToRows(notNeededGroups, applyWorklistFilters(cohorts.notNeeded, { search, state: null }, stateOf)),
    [notNeededGroups, cohorts.notNeeded, search, stateOf],
  )
  const visibleSwissGroups = useMemo(
    () => narrowToRows(swissGroups, applyWorklistFilters(cohorts.swiss, { search, state: null }, stateOf)),
    [swissGroups, cohorts.swiss, search, stateOf],
  )

  /**
   * Swiss Volley's own contact, rendered ONCE for the whole cohort rather than on
   * its group header: there is exactly one group here, and the letter is withheld
   * (it would ask Swiss Volley to grant a transfer TO Swiss Volley for players it
   * already licensed). "Who do we write to about a Swiss player missing from
   * VIS" is still a real question, so the address stays.
   */
  const swissFederation = derivations.federationByIso.get(swissGroups[0]?.key ?? 'CH') ?? null
  const swissEmails = splitEmails(swissFederation?.email)

  const searchBox = (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <Search
        className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={search}
        onChange={(e) => { onSearchChange(e.target.value) }}
        placeholder={t('trSearchPlaceholder')}
        aria-label={t('trSearchPlaceholder')}
        className="min-h-[44px] pl-8 sm:min-h-0"
      />
    </div>
  )

  /** The lead line every tab opens with: what this cohort IS, in one sentence. */
  const lead = (icon: ReactNode, text: string) => (
    <p className="mb-3 flex items-start gap-2 text-sm text-gray-500 dark:text-gray-400">
      {icon}
      <span>{text}</span>
    </p>
  )

  return (
    <Tabs value={activeTab} onValueChange={(v) => { onTabChange(v as CohortTab) }}>
      {/* Counts on every tab, including the empty ones — a cohort that is not
          counted is a cohort nobody can tell is empty. */}
      {/* ⚠ `h-auto` is load-bearing, not tidying. The TabsList primitive pins
          `h-9` on horizontal orientation, so once five triggers wrap to a second
          row on a phone the list overflows its own box and the tab strip renders
          ON TOP of the cohort description below it. The override has to match the
          same variant selector for tailwind-merge to replace it rather than emit
          both. */}
      <TabsList className="mb-4 w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
        <TabsTrigger value="worklist" className="min-h-11 sm:min-h-0">
          {t('trTabWorklist')} ({cohorts.needs.length})
        </TabsTrigger>
        <TabsTrigger value="clarify" className="min-h-11 sm:min-h-0">
          {t('trTabClarify')} ({cohorts.clarify.length})
        </TabsTrigger>
        <TabsTrigger value="notNeeded" className="min-h-11 sm:min-h-0">
          {t('trTabRuledOut')} ({cohorts.notNeeded.length})
        </TabsTrigger>
        <TabsTrigger value="swiss" className="min-h-11 sm:min-h-0">
          {t('trTabSwiss')} ({cohorts.swiss.length})
        </TabsTrigger>
        {/* Register disagreements only — the hidden tallies are counted on their
            own line under the page header, not folded in here. */}
        <TabsTrigger value="diagnostics" className="min-h-11 sm:min-h-0">
          {t('trTabDiagnostics')} ({conflicts.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="worklist">
        {cohorts.needs.length > 0 && (
          <>
            {lead(
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />,
              t('trNeedsDescription'),
            )}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {searchBox}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{t('trGroupBy')}</span>
                <Select value={groupBy} onValueChange={(v) => { onGroupByChange(v as GroupBy) }}>
                  <SelectTrigger aria-label={t('trGroupBy')} className="w-[11rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="federation">{t('trGroupByFederation')}</SelectItem>
                    <SelectItem value="state">{t('trGroupByState')}</SelectItem>
                    <SelectItem value="none">{t('trGroupByNone')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* The active chip is echoed next to the table it filters, and is
                  removable from here: a filter whose only "off" switch is a chip
                  further up the page reads as an empty worklist. */}
              {stateFilter && (
                <button
                  type="button"
                  onClick={() => { onStateFilterChange(null) }}
                  title={t('trClearFilter')}
                  aria-label={t('trClearFilter')}
                  className={cn(
                    badgeVariants({ variant: ROW_STATE_BADGE_VARIANT[stateFilter] }),
                    'min-h-[44px] min-w-[44px] gap-1 whitespace-normal break-words sm:min-h-0 sm:min-w-0',
                  )}
                >
                  <span>{stateLabel(stateFilter)}</span>
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              )}
            </div>
          </>
        )}

        {cohorts.needs.length === 0 ? (
          /* ⚠ Scoped to the WORKLIST tab alone. The tab strip above still reads
             'Ruled out (12)' and 'Swiss Volley (483)', which is what keeps
             "nobody needs a transfer" and "everybody was ruled out" two
             different answers — the reason the original rendered the ruled-out
             section outside this branch. */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 rounded-full bg-gray-100 p-4 dark:bg-gray-800">
              <CheckCircle2 className="h-8 w-8 text-green-500 dark:text-green-400" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('trEmptyTitle')}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('trEmptyDescription')}</p>
          </div>
        ) : (
          <TransferGroupTable
            groups={visibleNeedsGroups}
            mode="needs"
            groupBy={groupBy}
            derivations={derivations}
            actions={actions}
            openGroups={openGroups}
            onGroupOpenChange={onGroupOpenChange}
          />
        )}

        {/* The caveats the numbers cannot be read correctly without — below the
            work, not between the heading and the first actionable row. */}
        <AboutNumbersPanel />
      </TabsContent>

      {/* No search and no state chips here: the cohort is small, grouped by
          nationality, and has no derived state to filter by — these members have
          no federation answer yet, which is what the tab is for. */}
      <TabsContent value="clarify">
        {lead(
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" aria-hidden="true" />,
          t('trClarifyDescription'),
        )}
        <TransferGroupTable
          groups={clarifyGroups}
          mode="clarify"
          derivations={derivations}
          actions={actions}
          openGroups={openGroups}
          onGroupOpenChange={onGroupOpenChange}
        />
      </TabsContent>

      <TabsContent value="notNeeded">
        {lead(
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />,
          t('trNotNeededDescription'),
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2">{searchBox}</div>
        <TransferGroupTable
          groups={visibleNotNeededGroups}
          mode="notNeeded"
          derivations={derivations}
          actions={actions}
          openGroups={openGroups}
          onGroupOpenChange={onGroupOpenChange}
        />
      </TabsContent>

      <TabsContent value="swiss">
        {lead(
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />,
          t('trSwissDescription'),
        )}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {searchBox}
          {!swissFederation ? (
            // No directory row for CH — say so plainly. An empty mailto: would
            // look like a working contact and silently go nowhere.
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('trVisFederationMissing', { code: swissGroups[0]?.key || 'CH' })}
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                {prettyFederationName(swissFederation.name)}
              </span>
              {swissEmails.length === 0 ? (
                <span className="text-xs text-gray-500 dark:text-gray-400">{t('trVisNoEmail')}</span>
              ) : (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {/* mailto on the FIRST address only — VIS lists several for
                      many federations and which one is right is the club's call,
                      so the rest are copied but not pre-picked. */}
                  <a
                    href={`mailto:${swissEmails[0]}`}
                    className="text-xs font-medium break-all text-brand-700 hover:underline dark:text-brand-200"
                  >
                    {swissEmails[0]}
                  </a>
                  <CopyButton
                    value={swissEmails.join('; ')}
                    title={swissEmails.length > 1 ? t('trCopyEmails') : t('trCopyEmail')}
                  />
                  {swissEmails.length > 1 && (
                    <span
                      className="text-xs text-gray-400 dark:text-gray-500"
                      title={swissEmails.slice(1).join('; ')}
                    >
                      {t('trVisMoreAddresses', { count: swissEmails.length - 1 })}
                    </span>
                  )}
                </span>
              )}
            </span>
          )}
        </div>
        <TransferGroupTable
          groups={visibleSwissGroups}
          mode="swiss"
          derivations={derivations}
          actions={actions}
          openGroups={openGroups}
          onGroupOpenChange={onGroupOpenChange}
        />
      </TabsContent>

      <TabsContent value="diagnostics">{diagnostics}</TabsContent>
    </Tabs>
  )
}
