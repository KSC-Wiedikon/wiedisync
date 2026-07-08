import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, ArrowUpFromLine, AlertTriangle, CheckCircle2, EyeOff } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { kscwApi } from '../../../lib/api'

interface FieldChange { field: string; old_value?: string | null; new_value?: string | null }
// stale = the linked ClubDesk contact no longer exists (deleted CD-side): /up's
// stale-link guard would skip the member anyway, so the modal shows why and
// offers mute instead of silently re-listing the member on every open.
interface ChangedMember { id: number; first_name: string; last_name: string; email: string; clubdesk_id: string; changes: FieldChange[]; stale?: boolean }
interface UnlinkedMember { id: number; first_name: string; last_name: string; email: string; likely_non_member: boolean; beitragskategorie?: string | null; offiziellen_lizenz?: string | null; mitgliederbeitrag?: string | null }
interface Preview { changed: ChangedMember[]; unlinked: UnlinkedMember[] }
interface UpResult { total?: number | null; neu?: number | null; veraendert?: number | null; committed?: boolean }
interface UpStatus { state: 'idle' | 'queued' | 'running' | 'done' | 'failed'; message: string | null; result: UpResult | null }

type Phase = 'loading' | 'review' | 'pushing' | 'done' | 'error'

export default function ClubdeskSyncUpModal({ open, onOpenChange, onDone }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone?: () => void | Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [phase, setPhase] = useState<Phase>('loading')
  const [preview, setPreview] = useState<Preview>({ changed: [], unlinked: [] })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<UpResult | null>(null)
  const [error, setError] = useState('')

  const resetState = useCallback(() => {
    setPhase('loading'); setPreview({ changed: [], unlinked: [] }); setSelected(new Set()); setResult(null); setError('')
  }, [])

  // Reset on close (an event handler, not an effect — avoids synchronous setState in
  // the effect body). Blocks closing mid-push.
  const handleOpenChange = useCallback((v: boolean) => {
    if (phase === 'pushing') return
    if (!v) resetState()
    onOpenChange(v)
  }, [phase, onOpenChange, resetState])

  // Load the preview when opened. setState happens only in async callbacks, never
  // synchronously in the effect body.
  useEffect(() => {
    if (!open) return
    let alive = true
    kscwApi<Preview>('/clubdesk-member-sync/up-preview')
      .then((p) => {
        if (!alive) return
        setPreview(p)
        const sel = new Set<number>()
        p.changed.forEach((m) => { if (!m.stale) sel.add(m.id) })
        p.unlinked.forEach((m) => { if (!m.likely_non_member) sel.add(m.id) })
        setSelected(sel)
        setPhase('review')
      })
      .catch((e) => { if (alive) { setError((e as { body?: { error?: string } })?.body?.error || (e as Error).message); setPhase('error') } })
    return () => { alive = false }
  }, [open])

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  // Mute a member from the sync-up permanently (clubdesk_sync_exclude,
  // migration 190) — for technical rows like the System KSCW account.
  // Unmute via the Directus admin UI / Data Explorer.
  const mute = useCallback(async (id: number) => {
    try {
      await kscwApi('/clubdesk-member-sync/mute', { method: 'POST', body: { member_id: id, muted: true } })
      setPreview((p) => ({ changed: p.changed.filter((m) => m.id !== id), unlinked: p.unlinked.filter((m) => m.id !== id) }))
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success(t('clubdeskUpMuted'))
    } catch (e) {
      toast.error((e as { body?: { error?: string } })?.body?.error || (e as Error).message)
    }
  }, [t])

  const push = useCallback(async () => {
    const ids = [...selected]
    if (!ids.length) return
    setPhase('pushing'); setError('')
    try {
      // Surface server-side skips (stale link / blank risk): the push proceeds
      // for the rest, but the operator must know these members were NOT pushed
      // — otherwise a partial skip looks like a full success and the member
      // silently resurfaces on every preview (review finding 2026-07-08).
      const q = await kscwApi<{ skipped_stale_link?: number[]; skipped_blank_risk?: number[] }>(
        '/clubdesk-member-sync/up', { method: 'POST', body: { member_ids: ids } })
      const nSkipped = (q.skipped_stale_link?.length ?? 0) + (q.skipped_blank_risk?.length ?? 0)
      if (nSkipped > 0) toast.warning(t('clubdeskUpSkipped', { count: nSkipped }))
      // Scale with batch size: bulk drift-fills can push 100+ rows through the
      // per-minute dispatcher + Playwright import — a fixed 240 s would show a
      // false timeout while the push keeps running.
      const deadline = Date.now() + 240_000 + ids.length * 2_000
      for (;;) {
        await new Promise((r) => setTimeout(r, 5_000))
        const s = await kscwApi<UpStatus>('/clubdesk-member-sync/up-status')
        if (s.state === 'done') { setResult(s.result); setPhase('done'); break }
        if (s.state === 'failed') throw new Error(s.message || t('clubdeskUpFailed'))
        if (Date.now() > deadline) throw new Error(t('clubdeskUpTimeout'))
      }
      toast.success(t('clubdeskUpDoneToast'))
      await onDone?.()
    } catch (e) {
      const state = (e as { body?: { state?: string } })?.body?.state
      if (state === 'queued' || state === 'running') { toast.info(t('clubdeskUpInProgress')); resetState(); onOpenChange(false); return }
      setError((e as { body?: { error?: string } })?.body?.error || (e as Error).message || t('clubdeskUpFailed'))
      setPhase('error')
    }
  }, [selected, t, onDone, onOpenChange, resetState])

  const selChanged = preview.changed.filter((m) => selected.has(m.id)).length
  const selUnlinked = preview.unlinked.filter((m) => selected.has(m.id)).length
  const nothing = preview.changed.length === 0 && preview.unlinked.length === 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpFromLine className="h-5 w-5" />{t('clubdeskUpTitle')}
          </DialogTitle>
        </DialogHeader>

        {phase === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />{t('clubdeskUpLoading')}
          </div>
        )}

        {phase === 'review' && (
          <div className="space-y-5">
            {nothing && (
              <div className="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {t('clubdeskUpNothing')}
              </div>
            )}

            {preview.changed.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('clubdeskUpChangedHeading', { count: preview.changed.length })}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>{t('clubdeskUpColName')}</TableHead>
                      <TableHead>{t('clubdeskUpColChanges')}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.changed.map((m) => (
                      <TableRow key={m.id} className={m.stale ? 'opacity-70' : undefined}>
                        <TableCell><Checkbox checked={selected.has(m.id)} disabled={m.stale} onCheckedChange={() => toggle(m.id)} /></TableCell>
                        <TableCell className="whitespace-normal break-words">
                          <div className="font-medium">{m.last_name} {m.first_name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{m.email}</div>
                          {m.stale && (
                            <Badge variant="outline" className="mt-0.5 border-amber-300 text-[10px] text-amber-700 dark:text-amber-300">
                              {t('clubdeskUpStale')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-normal break-words">
                          <div className="flex flex-wrap gap-1">
                            {m.changes.length ? m.changes.map((c, i) => (
                              <span key={i} className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                {c.field}: <span className="line-through opacity-70">{c.old_value || '—'}</span> → {c.new_value || '—'}
                              </span>
                            )) : <span className="text-xs text-gray-400">{t('clubdeskUpContactSync')}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="w-10 text-right">
                          {m.stale && (
                            <Button
                              type="button" variant="ghost" size="icon"
                              className="h-8 w-8 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                              title={t('clubdeskUpMute')}
                              onClick={() => mute(m.id)}
                            >
                              <EyeOff className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            {preview.unlinked.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('clubdeskUpUnlinkedHeading', { count: preview.unlinked.length })}
                </h3>
                <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('clubdeskUpUnlinkedNote')}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>{t('clubdeskUpColName')}</TableHead>
                      <TableHead>{t('clubdeskUpColEmail')}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.unlinked.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell><Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} /></TableCell>
                        <TableCell className="whitespace-normal break-words">
                          <div className="font-medium">{m.last_name} {m.first_name}</div>
                          <div className="flex flex-wrap gap-1">
                            {m.beitragskategorie && (
                              <Badge variant="outline" className="mt-0.5 text-[10px] text-gray-600 dark:text-gray-300">
                                {m.beitragskategorie}{m.mitgliederbeitrag ? ` · CHF ${m.mitgliederbeitrag}` : ''}
                              </Badge>
                            )}
                            {m.offiziellen_lizenz && (
                              <Badge variant="outline" className="mt-0.5 text-[10px] text-gray-600 dark:text-gray-300">
                                {m.offiziellen_lizenz}
                              </Badge>
                            )}
                            {m.likely_non_member && (
                              <Badge variant="outline" className="mt-0.5 border-amber-300 text-[10px] text-amber-700 dark:text-amber-300">
                                {t('clubdeskUpNonMember')}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal break-words text-xs text-gray-500 dark:text-gray-400">{m.email}</TableCell>
                        <TableCell className="w-10 text-right">
                          <Button
                            type="button" variant="ghost" size="icon"
                            className="h-8 w-8 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                            title={t('clubdeskUpMute')}
                            onClick={() => mute(m.id)}
                          >
                            <EyeOff className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            {!nothing && (
              <div className="flex flex-col gap-2 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {t('clubdeskUpSelected', { update: selChanged, create: selUnlinked })}
                </p>
                <Button onClick={push} disabled={selected.size === 0} className="gap-2">
                  <ArrowUpFromLine className="h-4 w-4" />{t('clubdeskUpPush', { count: selected.size })}
                </Button>
              </div>
            )}
          </div>
        )}

        {phase === 'pushing' && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            <p className="text-sm font-medium">{t('clubdeskUpPushing')}</p>
            <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">{t('clubdeskUpPushingNote')}</p>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            <p className="text-sm font-medium">{t('clubdeskUpResult', { neu: result?.neu ?? 0, veraendert: result?.veraendert ?? 0 })}</p>
            <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">{t('clubdeskUpReadback')}</p>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>{t('clubdeskUpClose')}</Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
            <p className="max-w-sm text-sm text-red-600 dark:text-red-400">{error || t('clubdeskUpFailed')}</p>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>{t('clubdeskUpClose')}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
