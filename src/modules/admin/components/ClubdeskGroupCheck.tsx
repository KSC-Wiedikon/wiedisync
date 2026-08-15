// src/modules/admin/components/ClubdeskGroupCheck.tsx
//
// "Consistency check" card — the single workbench for everything that can drift
// between ClubDesk and Wiedisync. Since the 2026-08-13 merge it lives on
// /admin/data-health next to the sync buttons, so the old aggregate-count rows in
// dataHealthChecks.ts (which existed only to point at the other page) are gone:
// this card IS the detail, and there is no second copy to fall out of step.
//
// PRESENTATIONAL. The page owns the fetch, because the "Fix groups" button needs
// the same findings to decide what it may act on — two fetches would let the
// button and the table disagree about what is on screen.
//
// ClubDesk group membership is MANUAL-ONLY (the CSV import treats Gruppen as a
// no-op). For a long time that made every check here read-only; the add/remove
// scrapers are now reachable via "Fix groups", but only for the classes where
// "this allocation is wrong" is unambiguous. Everything else is still a worklist
// for a human — see the per-section hints.
//
// Sections, roughly by severity:
//   • No ClubDesk group        — in zero CD groups. Those ON a team are urgent.
//   • Missing a group          — has groups, but not their team's.
//   • Wrong function           — on the team, but holding the other Funktion
//     ('(Spieler*in)' while wiedisync says guest, or vice versa). Removal-only:
//     both assignment paths are add-only, so a player flipped to guest keeps the
//     old allocation forever. Exportable as a clubdesk-remove-group worklist.
//   • Coach without coach group— coaches missing '<team> (Trainer*in)'.
//   • Billed as a player, no roster — pays a playing fee, on no roster. Bucketed
//     never / lapsed / older so it's triageable rather than a 166-row dump.
//   • In a CD group, not on the roster (strays)
//   • CD groups with no Wiedisync team
//   • Teams with no CD group configured — a config guard: an unmapped team is
//     invisible to every check above, so it must never be silently skipped.

import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChevronRight, Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toXlsx, downloadBlob } from '../utils/exportResults'
import LastBillCell from './LastBillCell'
import { filterBySport, type MemberFacets, type SportTab } from '../utils/sportTabs'
import {
  lastBillExport, type FeeRow, type GroupCheckResp, type LastBill, type MissingRow,
} from '../utils/clubdeskFindings'

/**
 * Compact sport marker: 'volleyball' → VB, 'basketball' → BB (full localized
 * name in the tooltip). `sport` is the backend's comma-separated distinct list;
 * '—' when the sport can't be derived (no team AND no VB/BB fee prefix).
 */
function SportBadges({ sport }: { sport: string }) {
  const { t } = useTranslation('common')
  const tokens = sport.split(', ').filter(Boolean)
  if (tokens.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <>
      {tokens.map((s) => (
        <span
          key={s}
          title={s === 'volleyball' ? t('volleyball') : s === 'basketball' ? t('basketball') : s}
          className="mr-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {s === 'volleyball' ? 'VB' : s === 'basketball' ? 'BB' : s}
        </span>
      ))}
    </>
  )
}

/** Collapsible section: header always shows the count, body loads on expand. */
function Section({
  title, hint, count, tone = 'warn', children,
}: {
  title: string
  hint: string
  count: number
  tone?: 'warn' | 'danger'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <section className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60"
        aria-expanded={open}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span
          className={
            'ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ' +
            (tone === 'danger'
              ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300')
          }
        >
          {count}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
          <div className="max-h-96 overflow-y-auto">{children}</div>
        </div>
      )}
    </section>
  )
}

interface Props {
  data: Required<GroupCheckResp>
  loading: boolean
  error: string | null
  onRefresh: () => void
  /** Which sport tab is active — 'club' never renders this card. */
  tab: SportTab
  /** Club-wide per-member facets (bills + section fallback). */
  facets: MemberFacets
}

export default function ClubdeskGroupCheck({ data, loading, error, onRefresh, tab, facets }: Props) {
  const { t, i18n } = useTranslation('admin')

  // A no-group member is by definition ALSO missing every expected group — drop
  // them from the missing/coach tables so nobody is listed twice.
  const view = useMemo(() => {
    const ngIds = new Set(data.no_group.map((r) => r.member_id))
    const bySport = <T extends { sport?: string; member_id?: number }>(rows: T[]) =>
      filterBySport(rows, tab, facets)
    return {
      noGroup: bySport([...data.no_group].sort((a, b) => Number(b.has_team) - Number(a.has_team))),
      missing: bySport(data.missing.filter((r) => !ngIds.has(r.member_id))),
      coach: bySport(data.coach_no_group.filter((r) => !ngIds.has(r.member_id))),
      // never > lapsed > older
      fee: bySport([...data.fee_no_roster].sort((a, b) => {
        const rank = { never: 0, lapsed: 1, older: 2 }
        return rank[a.severity] - rank[b.severity]
      })),
      // Not filtered by ngIds: a no-group member holds no token at all, so they
      // can never have a stale one — the two lists are disjoint by construction.
      stale: bySport(data.stale_funktion),
      strays: bySport(data.strays),
      // Group- and team-level, not member-level: no member_id to bucket on, and a
      // structural gap is club business regardless of which tab you are standing
      // in. They only carry a sport when the mapping itself names one.
      noTeamGroups: data.no_team_groups,
      unmapped: bySport(data.unmapped_teams),
      // Club-level like the two above: whether somebody is an Ehrenmitglied is
      // not a sport question, so it is not bucketed by tab.
      honorary: data.honorary_drift,
    }
  }, [data, tab, facets])

  const billOf = (memberId: number) => facets.bills[String(memberId)] ?? null

  const onTeamCount = view.noGroup.filter((r) => r.has_team).length
  const neverCount = view.fee.filter((r) => r.severity === 'never').length
  const total = view.noGroup.length + view.missing.length + view.coach.length
    + view.fee.length + view.stale.length + view.strays.length + view.noTeamGroups.length + view.unmapped.length
    + view.honorary.length

  // Export is always English (exports-always-English convention).
  const handleExport = async () => {
    try {
      const tEn = i18n.getFixedT('en', 'admin')
      const sportEn = (s: string) => s.split(', ').filter(Boolean)
        .map((x) => x === 'volleyball' ? 'Volleyball' : x === 'basketball' ? 'Basketball' : x).join(', ')
      const columns = [
        'Issue', 'Name', 'Sport', 'ClubDesk ID', 'Detail', 'Fee category', 'Last rostered', 'Coach / TR',
        'Last bill', 'Bill status', 'Open amount',
      ]
      // Every member-level row carries its last invoice; group/team-level rows have
      // nobody to bill, so they pad the three columns out rather than shift them.
      const bill = (memberId: number) => lastBillExport(billOf(memberId))
      const noBill = ['', '', '']
      const rows: string[][] = [
        ...view.noGroup.map((r) => [
          r.has_team ? 'No ClubDesk group (on a team)' : 'No ClubDesk group',
          r.member_name, sportEn(r.sport), r.clubdesk_id, r.teams, r.kat, '', '', ...bill(r.member_id),
        ]),
        ...view.missing.map((r) => ['Missing a group', r.member_name, sportEn(r.sport), r.clubdesk_id, r.groups.join(', '), '', '', '', ...bill(r.member_id)]),
        ...view.coach.map((r) => ['Coach missing coach group', r.member_name, sportEn(r.sport), r.clubdesk_id, r.groups.join(', '), '', '', '', ...bill(r.member_id)]),
        ...view.stale.map((r) => [
          'Wrong ClubDesk function',
          r.member_name, sportEn(r.sport), r.clubdesk_id,
          `Remove "${r.group}"${r.has_correct ? '' : ` · add "${r.expected}"`}`, '', '', '', ...bill(r.member_id),
        ]),
        ...view.fee.map((r) => [
          `Billed as player, no roster (${r.severity})`,
          r.member_name, sportEn(r.sport), r.clubdesk_id, '', r.kat, r.last_season ?? '', [r.coach_of, r.tr_of].filter(Boolean).join(' / '),
          ...bill(r.member_id),
        ]),
        ...view.strays.map((r) => [
          'In ClubDesk group, not on roster',
          r.member_name, sportEn(r.sport), r.clubdesk_id, r.group, '', '', [r.coach_of, r.tr_of].filter(Boolean).join(' / '),
          ...bill(r.member_id),
        ]),
        ...view.noTeamGroups.map((r) => ['ClubDesk group with no team', '', '', '', r.group, '', '', String(r.count), ...noBill]),
        ...view.unmapped.map((r) => ['Team with no ClubDesk group configured', r.name, sportEn(r.sport), '', '', '', '', '', ...noBill]),
      ]
      void tEn
      const blob = await toXlsx(columns, rows)
      downloadBlob(blob, `clubdesk_consistency_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error(t('clubdeskGroupExportFailed'))
    }
  }

  // Removal worklist for `clubdesk-remove-group.mjs <worklist.json> preview|commit`
  // — exactly its three input fields, nothing else. Rows still needing the correct
  // token added are included: the removal is right either way, and the add half is
  // already covered by the `missing` section's own worklist.
  const handleWorklist = () => {
    const rows = view.stale.map((r) => ({
      name: r.clubdesk_name,
      uuid: r.uuid,
      group_label: r.group,
    }))
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `clubdesk_remove_funktion_${new Date().toISOString().slice(0, 10)}.json`)
  }

  const sevBadge = (s: FeeRow['severity']) => {
    const cls = s === 'never'
      ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
    const label = s === 'never' ? t('clubdeskFeeSevNever') : s === 'lapsed' ? t('clubdeskFeeSevLapsed') : t('clubdeskFeeSevOlder')
    return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />{t('clubdeskGroupCheckTitle')}
            </CardTitle>
            <CardDescription>{t('clubdeskGroupCheckDescription')}</CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('clubdeskGroupRefresh')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { void handleExport() }} disabled={loading || total === 0} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />{t('explorerGridExport')}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        {!error && loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />{t('clubdeskGroupCheckLoading')}
          </div>
        )}

        {!error && !loading && total === 0 && (
          <div className="flex items-center gap-2 py-4 text-sm text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4" />{t('clubdeskGroupCheckAllGood')}
          </div>
        )}

        {!error && !loading && total > 0 && (
          <>
            {/* Config guard first — an unmapped team makes every check below incomplete */}
            <Section
              title={t('clubdeskUnmappedTitle')}
              hint={t('clubdeskUnmappedHint')}
              count={view.unmapped.length}
              tone="danger"
            >
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('clubdeskColTeam')}</TableHead>
                    <TableHead>{t('clubdeskColSport')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.unmapped.map((r) => (
                    <TableRow key={r.team_id} className="min-h-11">
                      <TableCell className="whitespace-normal break-words font-medium">{r.name}</TableCell>
                      <TableCell><SportBadges sport={r.sport} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            {/* Ehrenmitglied asymmetry. Report-only: whether an honorary member
                still owes a fee is the treasurer's call, not a value to write. */}
            <Section
              title={t('clubdeskHonoraryTitle')}
              hint={t('clubdeskHonoraryHint')}
              count={view.honorary.length}
              tone="warn"
            >
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('clubdeskColMember')}</TableHead>
                    <TableHead>{t('clubdeskColIssue')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('clubdeskColKategorie')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.honorary.map((r) => (
                    <TableRow key={r.member_id} className="min-h-11">
                      <TableCell className="whitespace-normal break-words font-medium">{r.member_name}</TableCell>
                      <TableCell className="whitespace-normal break-words">
                        {r.kind === 'fee' ? t('clubdeskHonoraryFee') : t('clubdeskHonoraryStatusOnly')}
                      </TableCell>
                      <TableCell className="hidden whitespace-normal break-words text-gray-500 sm:table-cell dark:text-gray-400">
                        {r.kat || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            {/* No ClubDesk group */}
            <Section
              title={`${t('clubdeskGroupNoGroupTitle')}${onTeamCount > 0 ? ` · ${t('clubdeskGroupOnTeamCount', { count: onTeamCount })}` : ''}`}
              hint={t('clubdeskGroupNoGroupHint')}
              count={view.noGroup.length}
              tone={onTeamCount > 0 ? 'danger' : 'warn'}
            >
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('clubdeskGroupColName')}</TableHead>
                    <TableHead>{t('clubdeskColSport')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('clubdeskGroupColClubdeskId')}</TableHead>
                    <TableHead>{t('clubdeskGroupColTeams')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('clubdeskGroupColCategory')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('cdColLastBill')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.noGroup.map((r) => (
                    <TableRow key={r.member_id} className="min-h-11">
                      <TableCell className="whitespace-normal break-words font-medium">{r.member_name}</TableCell>
                      <TableCell><SportBadges sport={r.sport} /></TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{r.clubdesk_id}</TableCell>
                      <TableCell className="whitespace-normal break-words">
                        {r.has_team
                          ? (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              <AlertTriangle className="h-3 w-3" />{r.teams}
                            </span>
                          )
                          : <span className="text-muted-foreground">{t('clubdeskGroupNoTeam')}</span>}
                      </TableCell>
                      <TableCell className="hidden whitespace-normal break-words text-muted-foreground md:table-cell">{r.kat || '—'}</TableCell>
                      <TableCell className="hidden whitespace-normal break-words lg:table-cell">
                        <LastBillCell bill={billOf(r.member_id)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            {/* Missing a group */}
            <Section title={t('clubdeskGroupMissingTitle')} hint={t('clubdeskGroupMissingHint')} count={view.missing.length}>
              <GroupTable rows={view.missing} t={t} billOf={billOf} />
            </Section>

            {/* Wrong ClubDesk Funktion for a team they are still on */}
            <Section title={t('clubdeskStaleTitle')} hint={t('clubdeskStaleHint')} count={view.stale.length}>
              <div className="mb-2">
                <Button type="button" variant="outline" size="sm" onClick={handleWorklist} className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />{t('clubdeskStaleWorklist')}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('clubdeskGroupColName')}</TableHead>
                    <TableHead>{t('clubdeskColSport')}</TableHead>
                    <TableHead>{t('clubdeskStaleColRemove')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('clubdeskStaleColKeep')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.stale.map((r) => (
                    <TableRow key={`${r.member_id}-${r.group}`} className="min-h-11">
                      <TableCell className="whitespace-normal break-words font-medium">{r.member_name}</TableCell>
                      <TableCell><SportBadges sport={r.sport} /></TableCell>
                      <TableCell className="whitespace-normal break-words">
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 line-through dark:bg-red-950 dark:text-red-300">
                          {r.group}
                        </span>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal break-words sm:table-cell">
                        <span
                          className={
                            'rounded px-1.5 py-0.5 text-xs font-medium '
                            + (r.has_correct
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300')
                          }
                          title={r.has_correct ? undefined : t('clubdeskStaleNeedsAdd')}
                        >
                          {r.expected}{r.has_correct ? '' : ' +'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            {/* Coach missing their coach group */}
            <Section title={t('clubdeskCoachTitle')} hint={t('clubdeskCoachHint')} count={view.coach.length}>
              <GroupTable rows={view.coach} t={t} billOf={billOf} />
            </Section>

            {/* Billed as a player, but on no roster */}
            <Section
              title={`${t('clubdeskFeeTitle')}${neverCount > 0 ? ` · ${t('clubdeskFeeNeverCount', { count: neverCount })}` : ''}`}
              hint={t('clubdeskFeeHint')}
              count={view.fee.length}
              tone={neverCount > 0 ? 'danger' : 'warn'}
            >
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('clubdeskGroupColName')}</TableHead>
                    <TableHead>{t('clubdeskColSport')}</TableHead>
                    <TableHead>{t('clubdeskGroupColCategory')}</TableHead>
                    {/* The whole point of this section is "they pay to play but
                        play nowhere" — so whether they were actually billed, and
                        whether it is still open, belongs on the row. */}
                    <TableHead>{t('cdColLastBill')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('clubdeskColLastSeason')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('clubdeskColRole')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.fee.map((r) => {
                    const role = [r.coach_of && `${t('explorerFieldCoach')}: ${r.coach_of}`, r.tr_of && `TR: ${r.tr_of}`]
                      .filter(Boolean).join(' · ')
                    return (
                      <TableRow key={r.member_id} className="min-h-11">
                        <TableCell className="whitespace-normal break-words font-medium">
                          {r.member_name} {sevBadge(r.severity)}
                        </TableCell>
                        <TableCell><SportBadges sport={r.sport} /></TableCell>
                        <TableCell className="whitespace-normal break-words text-muted-foreground">{r.kat}</TableCell>
                        <TableCell className="whitespace-normal break-words">
                          <LastBillCell bill={billOf(r.member_id)} />
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                          {r.last_season ?? '—'}
                        </TableCell>
                        <TableCell className="hidden whitespace-normal break-words text-muted-foreground md:table-cell">
                          {role || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Section>

            {/* Strays — in a CD group but not on the roster */}
            <Section title={t('clubdeskStrayTitle')} hint={t('clubdeskStrayHint')} count={view.strays.length}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('clubdeskGroupColName')}</TableHead>
                    <TableHead>{t('clubdeskColSport')}</TableHead>
                    <TableHead>{t('clubdeskColGroup')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('cdColLastBill')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('clubdeskColRole')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.strays.map((r) => {
                    const tags = [
                      r.active ? null : t('clubdeskStrayInactive'),
                      r.is_official ? t('clubdeskStrayOfficial') : null,
                      r.coach_of && `${t('explorerFieldCoach')}: ${r.coach_of}`,
                      r.tr_of && `TR: ${r.tr_of}`,
                    ].filter(Boolean).join(' · ')
                    return (
                      <TableRow key={`${r.member_id}-${r.group}`} className="min-h-11">
                        <TableCell className="whitespace-normal break-words font-medium">{r.member_name}</TableCell>
                        <TableCell><SportBadges sport={r.sport} /></TableCell>
                        <TableCell className="whitespace-normal break-words">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.group}</span>
                          {/* Which rows "Fix groups" is allowed to strip unattended.
                              The rest are AMBIGUOUS — usually a missing wiedisync
                              roster row rather than a wrong ClubDesk group — and
                              removing those is what wiped 29 DU20 girls out of the
                              register on 2026-07-16. Say so on the row, not just in
                              a comment nobody reads at 23:00. */}
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {r.auto_removable ? t('clubdeskStrayAutoRemovable') : t('clubdeskStrayNeedsDecision')}
                          </span>
                        </TableCell>
                        <TableCell className="hidden whitespace-normal break-words lg:table-cell">
                          <LastBillCell bill={billOf(r.member_id)} />
                        </TableCell>
                        <TableCell className="hidden whitespace-normal break-words text-muted-foreground md:table-cell">
                          {tags || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Section>

            {/* CD groups with no Wiedisync team */}
            <Section title={t('clubdeskNoTeamGroupTitle')} hint={t('clubdeskNoTeamGroupHint')} count={view.noTeamGroups.length}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t('clubdeskColGroup')}</TableHead>
                    <TableHead>{t('clubdeskColMembers')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.noTeamGroups.map((r) => (
                    <TableRow key={r.group} className="min-h-11">
                      <TableCell className="whitespace-normal break-words font-medium">{r.group}</TableCell>
                      <TableCell className="text-muted-foreground">{r.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>

            <p className="pt-1 text-xs text-muted-foreground">{t('clubdeskGroupManualHint')}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Shared table for the two "missing a group token" checks. */
function GroupTable({ rows, t, billOf }: {
  rows: MissingRow[]
  t: (k: string) => string
  billOf: (memberId: number) => LastBill | null
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t('clubdeskGroupColName')}</TableHead>
          <TableHead>{t('clubdeskColSport')}</TableHead>
          <TableHead className="hidden sm:table-cell">{t('clubdeskGroupColClubdeskId')}</TableHead>
          <TableHead>{t('clubdeskGroupColMissing')}</TableHead>
          <TableHead className="hidden lg:table-cell">{t('cdColLastBill')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.member_id} className="min-h-11">
            <TableCell className="whitespace-normal break-words font-medium">{r.member_name}</TableCell>
            <TableCell><SportBadges sport={r.sport} /></TableCell>
            <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{r.clubdesk_id}</TableCell>
            <TableCell className="whitespace-normal break-words">
              {r.groups.map((g) => (
                <span
                  key={g}
                  className="mr-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  {g}
                </span>
              ))}
              {/* A row with no uuid cannot be located in the ClubDesk grid safely
                  (name drift is normal, and the clubdesk_id is not searchable), so
                  "Fix groups" skips it rather than guessing at a contact. */}
              {!r.uuid && (
                <span className="mt-0.5 block text-xs text-muted-foreground">{t('clubdeskNoUuidSkip')}</span>
              )}
            </TableCell>
            <TableCell className="hidden whitespace-normal break-words lg:table-cell">
              <LastBillCell bill={billOf(r.member_id)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
