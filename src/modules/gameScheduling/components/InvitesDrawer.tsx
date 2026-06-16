import { useEffect, useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '../../../components/ui/drawer'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Checkbox } from '../../../components/ui/checkbox'
import { Input } from '../../../components/ui/input'
import { Textarea } from '../../../components/ui/textarea'
import { Table, TableBody, TableCell, TableRow } from '../../../components/ui/table'
import { parseInviteCsv } from '../utils/parseInviteCsv'
import { formatDateTimeCompact } from '../../../utils/dateHelpers'
import type { useInvites } from '../hooks/useInvites'
import type { InviteSource } from '../../../types'

type InvitesApi = ReturnType<typeof useInvites>

interface DraftRow {
  id: string
  team_name: string
  contact_email: string
  contact_name: string
  source: InviteSource
  selected: boolean
  imported?: boolean
  warning?: string
  game_count?: number
  games?: { date: string | null; display_name: string | null; is_home_kscw: boolean }[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  kscwTeam: { id: string | number; name: string; league: string } | null
  api: InvitesApi
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export default function InvitesDrawer({ open, onOpenChange, kscwTeam, api }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [csvText, setCsvText] = useState('')
  const [importing, setImporting] = useState(false)
  const [loadingClubs, setLoadingClubs] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [gamesFor, setGamesFor] = useState<DraftRow | null>(null)

  const selectedCount = useMemo(() => drafts.filter((d) => d.selected).length, [drafts])

  const resetDrafts = () => {
    setDrafts([])
    setCsvText('')
  }

  // Drafts are team-scoped: the drawer stays mounted while the panel switches
  // teams, so clear any staged contacts when the selected team changes —
  // otherwise D1's imported contacts bleed into D2's drawer until a fresh import.
  useEffect(() => {
    setDrafts([])
    setCsvText('')
  }, [kscwTeam?.id])

  const runImport = async () => {
    if (!kscwTeam) return
    setImporting(true)
    try {
      const preview = await api.importFromSvrz()
      // One row per opponent TEAM — a club often lists several Spielplan
      // contacts; the invite is a single tokenized link sent to ALL of them, so
      // join the addresses (comma-separated) rather than emit a row per contact.
      const imported: DraftRow[] = preview.opponents.map((opp) => ({
        id: uid(),
        team_name: opp.team_name || opp.club_name,
        contact_email: opp.contacts.map((c) => c.email).filter(Boolean).join(', '),
        contact_name: opp.contacts.map((c) => c.name).filter(Boolean).join(', '),
        source: 'svrz' as InviteSource,
        selected: opp.contacts.length > 0,
        imported: true,
        warning: opp.contacts.length === 0 ? t('noContactWarning') : undefined,
        game_count: opp.game_count,
        games: opp.games,
      }))
      setDrafts((prev) => [...imported, ...prev])
      if (imported.length === 0) toast.info(t('svrzImportEmpty'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  // Load every opponent in the team's league from the ALREADY-SYNCED SVRZ data
  // (svrz_games + the bulk svrz_spielplaner_contacts feed) — instant, no live
  // login. All of a club's known contacts are joined into one shared-invite row
  // (parseRecipients splits them when sending). This is what auto-fills the
  // drawer on open; the live "Refresh" below re-fetches the freshest contacts.
  const loadLeagueClubs = async (opts?: { silent?: boolean }) => {
    if (!kscwTeam) return
    setLoadingClubs(true)
    try {
      const resp = await api.listSvrzClubs()
      // Opponents that already have an invite are auto-created at the panel level
      // and shown in the invite table — don't restage them as drafts here. What
      // remains is mostly opponents still missing a contact (skipped by
      // auto-create), which the admin completes by hand.
      const invitedNames = new Set(api.invites.map((i) => i.team_name.trim().toLowerCase()))
      const rows: DraftRow[] = resp.clubs
        .filter((c) => !invitedNames.has((c.team_name || c.club_name).trim().toLowerCase()))
        .map((c) => {
        const emails = c.suggested_contacts.map((x) => x.email).filter(Boolean)
        const names = c.suggested_contacts.map((x) => x.name).filter(Boolean)
        return {
          id: uid(),
          team_name: c.team_name || c.club_name,
          contact_email: emails.join(', '),
          contact_name: names.join(', '),
          source: 'svrz',
          selected: emails.length > 0,
          imported: true,
          game_count: c.game_count,
          games: c.games,
          warning: emails.length === 0 ? t('noContactWarning') : undefined,
        }
      })
      setDrafts((prev) => [...rows, ...prev])
      if (rows.length === 0 && !opts?.silent) toast.info(t('noClubsFound'))
    } catch (err) {
      if (!opts?.silent) toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingClubs(false)
    }
  }

  // Auto-fill from synced data the first time the drawer opens for a team, so the
  // admin sees the opponents + contacts without importing every time. Runs once
  // per team (guarded by ref); the team-switch effect above clears stale drafts.
  const autoFilledTeam = useRef<string | number | null>(null)
  useEffect(() => {
    if (!open || !kscwTeam) return
    if (autoFilledTeam.current === kscwTeam.id) return
    autoFilledTeam.current = kscwTeam.id
    loadLeagueClubs({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kscwTeam?.id])

  const parseCsv = () => {
    const rows = parseInviteCsv(csvText)
    const mapped: DraftRow[] = rows.map((r) => ({
      id: uid(),
      team_name: r.team_name,
      contact_email: r.contact_email,
      contact_name: r.contact_name,
      source: 'manual' as InviteSource,
      selected: !r.error && !!r.contact_email,
      warning: r.error,
    }))
    setDrafts((prev) => [...mapped, ...prev])
    setCsvText('')
  }

  const updateDraft = (id: string, patch: Partial<DraftRow>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id))
  }

  const submit = async () => {
    const picked = drafts.filter((d) => d.selected && d.contact_email && d.team_name)
    if (picked.length === 0) {
      toast.error(t('selectToInvite'))
      return
    }
    setSubmitting(true)
    try {
      // Group by source for cleaner attribution (SVRZ-imported vs manual)
      const svrzRows = picked.filter((d) => d.source === 'svrz')
      const manualRows = picked.filter((d) => d.source !== 'svrz')
      let created = 0
      let existing = 0
      for (const group of [
        { rows: svrzRows, source: 'svrz' as InviteSource },
        { rows: manualRows, source: 'manual' as InviteSource },
      ]) {
        if (group.rows.length === 0) continue
        const resp = await api.createInvites(
          group.rows.map(({ team_name, contact_email, contact_name }) => ({ team_name, contact_email, contact_name })),
          group.source,
        )
        created += resp.created
        existing += resp.existing
      }
      toast.success(t('invitesCreated', { count: created }))
      if (existing > 0) toast.info(t('invitesExisting', { count: existing }))
      resetDrafts()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        <DrawerHeader>
          <DrawerTitle>
            {t('invitesTitle')} — {kscwTeam?.name} <span className="text-sm font-normal text-gray-500">({kscwTeam?.league})</span>
          </DrawerTitle>
          <DrawerDescription>{t('createInvites')}</DrawerDescription>
        </DrawerHeader>

        <div className="space-y-5 overflow-y-auto px-6 pb-4">
          {/* Opponent contacts — auto-fill from the last SVRZ sync on open. The
              two buttons are optional: re-pull the synced data, or do a slow live
              re-fetch for the freshest contacts. */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('opponentContacts')}</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => loadLeagueClubs()} disabled={loadingClubs || !kscwTeam}>
                  {loadingClubs ? t('loadingClubs') : t('reloadSynced')}
                </Button>
                <Button size="sm" variant="outline" onClick={runImport} disabled={importing || !kscwTeam}>
                  {importing ? t('svrzImportLoading') : t('refreshFromSvrzLive')}
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('autoFillHint')}</p>
          </div>

          {/* Manual CSV paste */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{t('addManually')}</h3>
            <Textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={t('csvPlaceholder')}
              rows={3}
              className="font-mono text-xs"
            />
            <Button size="sm" className="mt-2" variant="secondary" onClick={parseCsv} disabled={!csvText.trim()}>
              {t('parseRows')}
            </Button>
          </div>

          {/* Draft rows */}
          {drafts.length > 0 && (
            <div className="rounded border border-gray-200 dark:border-gray-700">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                    <th className="w-10 py-2 pl-3"></th>
                    <th className="py-2 pr-2">{t('inviteTeam')}</th>
                    <th className="py-2 pr-2">{t('inviteEmail')}</th>
                    <th className="hidden sm:table-cell py-2 pr-2">{t('inviteContact')}</th>
                    <th className="hidden sm:table-cell w-24 py-2 pr-2">{t('inviteSource')}</th>
                    <th className="w-10 py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id} className="border-b border-gray-200 last:border-0 dark:border-gray-800 [&>td]:align-top">
                      <td className="py-1.5 pl-3">
                        <Checkbox checked={d.selected} onCheckedChange={(v) => updateDraft(d.id, { selected: !!v })} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          value={d.team_name}
                          onChange={(e) => updateDraft(d.id, { team_name: e.target.value })}
                          className="h-8 text-sm"
                        />
                        {d.game_count != null &&
                          (d.games && d.games.length ? (
                            <button
                              type="button"
                              onClick={() => setGamesFor(d)}
                              className="mt-0.5 text-[10px] text-blue-600 underline decoration-dotted hover:text-blue-700 dark:text-blue-400"
                            >
                              {t('gameCount', { count: d.game_count })}
                            </button>
                          ) : (
                            <div className="mt-0.5 text-[10px] text-gray-500">
                              {t('gameCount', { count: d.game_count })}
                            </div>
                          ))}
                      </td>
                      <td className="py-1.5 pr-2">
                        <Input
                          value={d.contact_email}
                          onChange={(e) => updateDraft(d.id, { contact_email: e.target.value })}
                          className="h-8 text-sm"
                          type="email"
                          multiple
                        />
                        {d.warning && (
                          <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">⚠ {d.warning}</div>
                        )}
                      </td>
                      <td className="hidden sm:table-cell py-1.5 pr-2">
                        <Input
                          value={d.contact_name}
                          onChange={(e) => updateDraft(d.id, { contact_name: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="hidden sm:table-cell py-1.5 pr-2 text-xs">
                        <Badge variant={d.source === 'svrz' ? 'default' : 'secondary'}>
                          {d.source === 'svrz' ? 'SVRZ' : t('sourceManual')}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeDraft(d.id)}
                          className="inline-flex h-11 w-11 items-center justify-center text-xs text-gray-400 hover:text-red-600"
                          aria-label="Remove"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DrawerFooter className="border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {selectedCount} / {drafts.length}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={submit} disabled={submitting || selectedCount === 0}>
                {t('createInvites')}
              </Button>
            </div>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>

    {/* Games for one opponent draft row */}
    <Dialog open={!!gamesFor} onOpenChange={(o) => { if (!o) setGamesFor(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{gamesFor?.team_name}</DialogTitle>
          <DialogDescription>
            {t('gameCount', { count: gamesFor?.game_count ?? gamesFor?.games?.length ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableBody>
              {(gamesFor?.games ?? []).map((g, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {g.date ? formatDateTimeCompact(g.date) : '—'}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-400 whitespace-normal break-words">
                    {g.is_home_kscw
                      ? `KSCW ${kscwTeam?.name ?? ''} vs ${gamesFor?.team_name ?? ''}`
                      : `${gamesFor?.team_name ?? ''} vs KSCW ${kscwTeam?.name ?? ''}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
