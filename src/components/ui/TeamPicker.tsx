// ── Team pickers (single + multi) ────────────────────────────────────────────
//
// Both live in one file because they share the option type, the sport grouping
// and the sport badge. Lifted from the `TeamPicker` popover in
// `src/modules/admin/components/ExplorerGrid.tsx` (Popover + cmdk Command), with
// two deliberate changes: the trigger is a full ≥44px control instead of that
// file's 24px `+` circle, and every option row carries a sport badge.
//
// ⚠ Team NAMES lie. 'Herren 2 H3' and 'Damen D-Classics 1LR' are basketball.
// The sport therefore always comes from `TeamPickerOption.sport` (fed from
// `teams.sport`) and is shown on the row, the chip and the trigger — never
// inferred from the label.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown, Loader2, Plus, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

export interface TeamPickerOption {
  id: string
  /** Display label, already trimmed/prefixed by the caller. */
  label: string
  sport: 'volleyball' | 'basketball' | null
  season?: string | null
  active?: boolean
}

const SPORT_ORDER = ['volleyball', 'basketball', null] as const

/**
 * Sport marker so a basketball team called 'Herren 2 H3' cannot be misread.
 * Owns its own title so no call site has to re-derive the sport name.
 */
function SportBadge({ sport }: { sport: TeamPickerOption['sport'] }) {
  const { t } = useTranslation('common')
  if (!sport) return null
  return (
    <span
      title={sport === 'volleyball' ? t('volleyball') : t('basketball')}
      className={cn(
        'shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold leading-none',
        sport === 'volleyball'
          ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200'
          : 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200',
      )}
    >
      {sport === 'volleyball' ? 'VB' : 'BB'}
    </span>
  )
}

interface SportGroup {
  sport: TeamPickerOption['sport']
  heading: string
  teams: TeamPickerOption[]
}

/** Group by sport, in a fixed order, dropping sports with no teams. */
function useSportGroups(teams: readonly TeamPickerOption[]): SportGroup[] {
  const { t } = useTranslation(['admin', 'common'])
  return useMemo(() => {
    const headingFor = (sport: TeamPickerOption['sport']): string =>
      sport === 'volleyball'
        ? t('common:volleyball')
        : sport === 'basketball'
          ? t('common:basketball')
          : t('admin:explorerSportOther')
    return SPORT_ORDER
      .map((sport) => ({
        sport,
        heading: headingFor(sport),
        teams: teams.filter((tm) => (tm.sport ?? null) === sport),
      }))
      .filter((group) => group.teams.length > 0)
  }, [teams, t])
}

/** cmdk filters on this string — the label, the sport heading and the sport code all hit. */
function searchValue(team: TeamPickerOption, heading: string): string {
  return [team.label, heading, team.sport ?? '', team.season ?? '', team.id]
    .filter(Boolean)
    .join(' ')
}

function TeamOptionRow({
  team, heading, selected, onPick,
}: {
  team: TeamPickerOption
  heading: string
  selected: boolean
  onPick: () => void
}) {
  return (
    <CommandItem
      value={searchValue(team, heading)}
      onSelect={onPick}
      className={cn(
        'min-h-[44px] border-l-2 px-3',
        selected
          ? 'border-l-primary bg-primary/10 font-semibold text-primary dark:bg-primary/30 dark:text-primary-foreground'
          : 'border-l-transparent',
        team.active === false && 'opacity-60',
      )}
    >
      <Check className={cn('h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      <span className="flex-1 truncate">{team.label}</span>
      {team.season && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{team.season}</span>
      )}
      <SportBadge sport={team.sport} />
    </CommandItem>
  )
}

// ── Single ───────────────────────────────────────────────────────────────────

export interface TeamPickerSingleProps {
  /** Team id as a string, or null. The caller converts to/from the integer column. */
  value: string | null
  onChange: (teamId: string | null) => void
  teams: readonly TeamPickerOption[]
  disabled?: boolean
  placeholder?: string
  /** Label of the "no team" item. Default '—'. */
  emptyLabel?: string
  className?: string
}

export function TeamPickerSingle({
  value,
  onChange,
  teams,
  disabled,
  placeholder,
  emptyLabel = '—',
  className,
}: TeamPickerSingleProps) {
  const { t } = useTranslation(['admin', 'common'])
  const [open, setOpen] = useState(false)
  const groups = useSportGroups(teams)
  const selected = teams.find((tm) => tm.id === value) ?? null

  function pick(teamId: string | null) {
    setOpen(false)
    onChange(teamId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex min-h-[44px] w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          {selected ? (
            <>
              <span className="flex-1 truncate">{selected.label}</span>
              <SportBadge sport={selected.sport} />
            </>
          ) : (
            <span className="flex-1 truncate text-muted-foreground">
              {placeholder ?? emptyLabel}
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder={t('admin:explorerGridSearchTeams')} />
          <CommandList>
            <CommandEmpty>{t('admin:explorerGridNoTeams')}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={emptyLabel}
                onSelect={() => pick(null)}
                className={cn(
                  'min-h-[44px] border-l-2 px-3',
                  value === null
                    ? 'border-l-primary bg-primary/10 font-semibold text-primary dark:bg-primary/30 dark:text-primary-foreground'
                    : 'border-l-transparent',
                )}
              >
                <Check className={cn('h-4 w-4 shrink-0', value === null ? 'opacity-100' : 'opacity-0')} />
                <span className="flex-1 truncate text-muted-foreground">{emptyLabel}</span>
              </CommandItem>
            </CommandGroup>
            {groups.map((group) => (
              <CommandGroup key={group.sport ?? 'other'} heading={group.heading}>
                {group.teams.map((tm) => (
                  <TeamOptionRow
                    key={tm.id}
                    team={tm}
                    heading={group.heading}
                    selected={tm.id === value}
                    onPick={() => pick(tm.id)}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ── Multi ────────────────────────────────────────────────────────────────────

export interface TeamPickerMultiProps {
  value: readonly string[]
  /** Called with the FULL next selection. The caller diffs it into junction writes. */
  onChange: (teamIds: string[]) => void | Promise<void>
  teams: readonly TeamPickerOption[]
  disabled?: boolean
  /** Ids with an in-flight write — rendered with a spinner and not removable. */
  busyIds?: ReadonlySet<string>
  placeholder?: string
  className?: string
}

export function TeamPickerMulti({
  value,
  onChange,
  teams,
  disabled,
  busyIds,
  placeholder,
  className,
}: TeamPickerMultiProps) {
  const { t } = useTranslation(['admin', 'common'])
  const [open, setOpen] = useState(false)
  const groups = useSportGroups(teams)
  const selectedSet = useMemo(() => new Set(value), [value])
  const byId = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams])

  function toggle(teamId: string) {
    if (busyIds?.has(teamId)) return
    const next = selectedSet.has(teamId)
      ? value.filter((id) => id !== teamId)
      : [...value, teamId]
    void onChange(next)
  }

  return (
    <div className={className}>
      {/* One bordered field, chips inside — mirrors CountryMultiSelect so a
          member already on two teams reads as "filled", not as an empty box. */}
      <div className="flex min-h-[44px] w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent p-1.5 text-sm shadow-sm">
        {value.map((id) => {
          const team = byId.get(id)
          const label = team?.label ?? id
          const busy = busyIds?.has(id) ?? false
          return (
            <span
              key={id}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border bg-muted/60 py-1 pl-2.5 pr-0.5 text-sm text-foreground"
            >
              <SportBadge sport={team?.sport ?? null} />
              <span className="font-medium">{label}</span>
              {busy ? (
                <span className="grid h-11 w-11 place-items-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </span>
              ) : (
                !disabled && (
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-label={`${t('common:remove')} ${label}`}
                    className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )
              )}
            </span>
          )
        })}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/50 px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {placeholder ?? t('admin:explorerFieldsTeamsPlaceholder')}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-0">
            <Command>
              <CommandInput placeholder={t('admin:explorerGridSearchTeams')} />
              <CommandList>
                <CommandEmpty>{t('admin:explorerGridNoTeams')}</CommandEmpty>
                {groups.map((group) => (
                  <CommandGroup key={group.sport ?? 'other'} heading={group.heading}>
                    {group.teams.map((tm) => (
                      <TeamOptionRow
                        key={tm.id}
                        team={tm}
                        heading={group.heading}
                        selected={selectedSet.has(tm.id)}
                        onPick={() => toggle(tm.id)}
                      />
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
