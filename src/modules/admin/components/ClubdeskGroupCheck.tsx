// src/modules/admin/components/ClubdeskGroupCheck.tsx
//
// "Group check" card for the ClubDesk sync page (superadmin). ClubDesk group
// membership is MANUAL-ONLY — the CSV import treats Gruppen as a no-op — so it
// silently drifts from the Wiedisync rosters. This surfaces two problems from
// GET /kscw/clubdesk-group-sync:
//
//   • No ClubDesk group — the member's ClubDesk contact carries no group token
//     at all. The urgent subset is those who ARE on a Wiedisync team (they play,
//     yet the register has them in nothing); the rest (no team) are usually
//     passive / officials / board and just want a review.
//   • Missing a group — the member has groups, but not the one for a team they
//     actually play in.
//
// Read-only by design: the fix is made by hand in ClubDesk, so the card's job is
// to produce an accurate, exportable worklist. Members with no group are shown
// in their own table and filtered out of "missing" so nobody is listed twice.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Check, Download, Loader2, RefreshCw, Users } from 'lucide-react'
import { kscwApi } from '../../../lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toXlsx, downloadBlob } from '../utils/exportResults'

interface NoGroupRow {
  member_id: number
  member_name: string
  clubdesk_id: string
  teams: string
  kat: string
  has_team: boolean
}

interface MissingRow {
  member_id: number
  member_name: string
  clubdesk_id: string
  groups: string[]
}

interface GroupSyncResponse {
  no_group?: NoGroupRow[]
  missing?: MissingRow[]
}

export default function ClubdeskGroupCheck() {
  const { t, i18n } = useTranslation('admin')
  const [noGroup, setNoGroup] = useState<NoGroupRow[]>([])
  const [missing, setMissing] = useState<MissingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await kscwApi<GroupSyncResponse>('/clubdesk-group-sync')
      const ng = res.no_group ?? []
      // A no-group member is, by definition, also "missing" every expected group —
      // drop them from the missing table so they aren't listed twice.
      const ngIds = new Set(ng.map((r) => r.member_id))
      setNoGroup(ng)
      setMissing((res.missing ?? []).filter((r) => !ngIds.has(r.member_id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch-on-mount: the setState lands in the async callback, not the effect
  // body, but the rule can't see through `void load()`. Same pattern as
  // useExplorerCache / ExplorerMemberFields.
  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { void load() }, [load])

  // Export is always English (exports-always-English convention).
  const handleExport = async () => {
    try {
      const tEn = i18n.getFixedT('en', 'admin')
      const columns = [
        'Issue',
        tEn('clubdeskGroupColName'),
        tEn('clubdeskGroupColClubdeskId'),
        tEn('clubdeskGroupColTeams'),
        tEn('clubdeskGroupColCategory'),
        tEn('clubdeskGroupColMissing'),
      ]
      const rows: string[][] = [
        ...noGroup.map((r) => [
          r.has_team ? 'No ClubDesk group (on a team)' : 'No ClubDesk group',
          r.member_name, r.clubdesk_id, r.teams, r.kat, '',
        ]),
        ...missing.map((r) => [
          'Missing a group',
          r.member_name, r.clubdesk_id, '', '', r.groups.join(', '),
        ]),
      ]
      const blob = await toXlsx(columns, rows)
      downloadBlob(blob, `clubdesk_group_check_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error(t('clubdeskGroupExportFailed'))
    }
  }

  const onTeamCount = noGroup.filter((r) => r.has_team).length
  const total = noGroup.length + missing.length

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />{t('clubdeskGroupCheckTitle')}
            </CardTitle>
            <CardDescription>{t('clubdeskGroupCheckDescription')}</CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => { void load() }} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('clubdeskGroupRefresh')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { void handleExport() }}
              disabled={loading || total === 0}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />{t('explorerGridExport')}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
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
            {/* No ClubDesk group at all */}
            {noGroup.length > 0 && (
              <section>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {t('clubdeskGroupNoGroupTitle')}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                    {noGroup.length}
                  </span>
                  {onTeamCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      {t('clubdeskGroupOnTeamCount', { count: onTeamCount })}
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('clubdeskGroupNoGroupHint')}</p>
                <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="sticky top-0 bg-card">{t('clubdeskGroupColName')}</TableHead>
                        <TableHead className="sticky top-0 hidden bg-card sm:table-cell">{t('clubdeskGroupColClubdeskId')}</TableHead>
                        <TableHead className="sticky top-0 bg-card">{t('clubdeskGroupColTeams')}</TableHead>
                        <TableHead className="sticky top-0 hidden bg-card md:table-cell">{t('clubdeskGroupColCategory')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Members who play but have no group are the urgent ones — first. */}
                      {[...noGroup].sort((a, b) => Number(b.has_team) - Number(a.has_team)).map((r) => (
                        <TableRow key={r.member_id} className="min-h-11">
                          <TableCell className="whitespace-normal break-words font-medium">{r.member_name}</TableCell>
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
                          <TableCell className="hidden whitespace-normal break-words text-muted-foreground md:table-cell">
                            {r.kat || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            {/* Has groups, but missing the one for a team they play in */}
            {missing.length > 0 && (
              <section>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {t('clubdeskGroupMissingTitle')}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                    {missing.length}
                  </span>
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('clubdeskGroupMissingHint')}</p>
                <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="sticky top-0 bg-card">{t('clubdeskGroupColName')}</TableHead>
                        <TableHead className="sticky top-0 hidden bg-card sm:table-cell">{t('clubdeskGroupColClubdeskId')}</TableHead>
                        <TableHead className="sticky top-0 bg-card">{t('clubdeskGroupColMissing')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {missing.map((r) => (
                        <TableRow key={r.member_id} className="min-h-11">
                          <TableCell className="whitespace-normal break-words font-medium">{r.member_name}</TableCell>
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
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}

            <p className="text-xs text-muted-foreground">{t('clubdeskGroupManualHint')}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
