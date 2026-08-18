import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Copy, Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { kscwApi } from '../../lib/api'
import { useReportPageLoading } from '../../hooks/usePageReady'
import { useConfirm } from '../../components/ConfirmProvider'
import { formatDateTimeCompact } from '../../utils/dateHelpers'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'

// ── Types ────────────────────────────────────────────────────────
// Mirrors LIST_COLUMNS + the computed has_password in
// kscw-endpoints/src/email-accounts.js. Keep the two in step.

type Sport = 'volleyball' | 'basketball' | 'club'
type Provider = 'migadu' | 'ses' | 'clubdesk' | 'google' | 'other'

interface EmailAccount {
  id: number
  address: string
  domain: string
  label: string | null
  sport: Sport
  provider: Provider
  notes: string | null
  migadu_managed: boolean
  is_active: boolean
  last_seen_at: string | null
  sort: number | null
  created_by_name: string | null
  updated_by_name: string | null
  date_created: string | null
  date_updated: string | null
  has_password: boolean
}

interface ListResponse {
  accounts: EmailAccount[]
  vault_configured: boolean
  can_edit: boolean
  scope: Sport[]
  migadu_configured: boolean
}

const SPORTS: Sport[] = ['club', 'volleyball', 'basketball']
const PROVIDERS: Provider[] = ['migadu', 'ses', 'clubdesk', 'google', 'other']

/**
 * How long a revealed password stays on screen. Short enough that a walked-away
 * laptop does not sit there showing the club's mailbox credentials, long enough
 * to type one by hand into a webmail login.
 */
const REVEAL_TTL_MS = 45_000

// ── Page ─────────────────────────────────────────────────────────

export default function EmailsGaragePage() {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sportFilter, setSportFilter] = useState<'' | Sport>('')
  const [syncing, setSyncing] = useState(false)

  // address → plaintext, only ever populated by an explicit reveal click.
  const [revealed, setRevealed] = useState<Record<number, string>>({})
  const [revealing, setRevealing] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [editing, setEditing] = useState<EmailAccount | 'new' | null>(null)

  // One timer per revealed row. Kept in a ref because clearing them on unmount
  // must not depend on a render having happened since the last reveal.
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  // Promise-chain rather than async/await on purpose: the state writes then sit
  // in .then/.finally callbacks, which is what lets this be called straight from
  // the mount effect without tripping react-hooks/set-state-in-effect. Same
  // shape as AnnouncementsPage's loader.
  const load = useCallback(() => (
    kscwApi<ListResponse>('/email-accounts')
      .then(setData)
      .catch(() => { toast.error(t('egLoadFailed')) })
      .finally(() => setLoading(false))
  ), [t])

  // Empty dep array on purpose (same shape as AnnouncementsPage / DataHealthPage):
  // this is the one initial fetch, and re-running it whenever `load`'s identity
  // changes would refetch on every locale change for nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])
  useReportPageLoading(loading)

  // Clear the auto-hide timers on unmount. The revealed plaintexts themselves go
  // with the component's state — the timers are the part that would otherwise
  // outlive it and fire a setState on a gone component.
  useEffect(() => {
    const pending = timers.current
    return () => { Object.values(pending).forEach(clearTimeout) }
  }, [])

  const canEdit = data?.can_edit === true

  const filtered = useMemo(() => {
    const accounts = data?.accounts ?? []
    const q = search.trim().toLowerCase()
    return accounts.filter((a) => {
      if (sportFilter && a.sport !== sportFilter) return false
      if (!q) return true
      return [a.address, a.label, a.notes, a.domain].some((v) => v?.toLowerCase().includes(q))
    })
  }, [data, search, sportFilter])

  const hide = useCallback((id: number) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    setRevealed((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const reveal = useCallback(async (account: EmailAccount) => {
    if (revealed[account.id] !== undefined) { hide(account.id); return }
    setRevealing(account.id)
    try {
      const res = await kscwApi<{ password: string }>(`/email-accounts/${account.id}/password`)
      setRevealed((prev) => ({ ...prev, [account.id]: res.password }))
      timers.current[account.id] = setTimeout(() => hide(account.id), REVEAL_TTL_MS)
    } catch (err) {
      const code = (err as { body?: { code?: string; error?: string } }).body
      toast.error(code?.error || t('egRevealFailed'))
    } finally {
      setRevealing(null)
    }
  }, [revealed, hide, t])

  const copy = useCallback(async (account: EmailAccount, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(account.id)
      setTimeout(() => setCopied((c) => (c === account.id ? null : c)), 1500)
    } catch {
      toast.error(t('egCopyFailed'))
    }
  }, [t])

  const remove = useCallback(async (account: EmailAccount) => {
    if (!(await confirm({ message: t('egDeleteConfirm', { address: account.address }), danger: true }))) return
    try {
      await kscwApi(`/email-accounts/${account.id}`, { method: 'DELETE' })
      toast.success(t('egDeleted'))
      hide(account.id)
      void load()
    } catch {
      toast.error(t('egDeleteFailed'))
    }
  }, [confirm, t, hide, load])

  const syncMigadu = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await kscwApi<{ added: number; reactivated: number; deactivated: number; found: number }>(
        '/email-accounts/sync-migadu', { method: 'POST' },
      )
      toast.success(t('egSyncDone', { found: res.found, added: res.added, deactivated: res.deactivated }))
      void load()
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body
      toast.error(body?.error || t('egSyncFailed'))
    } finally {
      setSyncing(false)
    }
  }, [t, load])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-gray-100">
          <KeyRound className="h-5 w-5" />
          {t('egTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('egDescription')}</p>
      </div>

      {/* The vault key is a deploy step, not a bug — say so rather than letting
          every reveal fail with a 503 the reader has to interpret. */}
      {data && !data.vault_configured && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('egVaultMissing')}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('egSearchPlaceholder')}
          className="min-w-[12rem] flex-1 rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <select
          value={sportFilter}
          onChange={(e) => setSportFilter(e.target.value as '' | Sport)}
          className="rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">{t('egAllSports')}</option>
          {SPORTS.filter((s) => data?.scope?.includes(s) ?? true).map((s) => (
            <option key={s} value={s}>{t(`egSport_${s}`)}</option>
          ))}
        </select>

        {canEdit && (
          <>
            <button
              onClick={syncMigadu}
              disabled={syncing || data?.migadu_configured === false}
              title={data?.migadu_configured === false ? t('egMigaduMissing') : undefined}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {t('egSyncMigadu')}
            </button>
            <button
              onClick={() => setEditing('new')}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
            >
              <Plus className="h-4 w-4" />
              {t('egAdd')}
            </button>
          </>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">…</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">{t('egEmpty')}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('egColAddress')}</TableHead>
                <TableHead className="hidden md:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('egColSport')}</TableHead>
                <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('egColProvider')}</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('egColPassword')}</TableHead>
                <TableHead className="hidden xl:table-cell text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('egColNotes')}</TableHead>
                {canEdit && <TableHead className="text-right text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('egColActions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const plain = revealed[a.id]
                return (
                  <TableRow key={a.id} className={`border-gray-200 dark:border-gray-700 ${a.is_active ? '' : 'opacity-50'}`}>
                    <TableCell className="min-h-[44px] whitespace-normal break-words align-top">
                      <button
                        type="button"
                        onClick={() => copy(a, a.address)}
                        className="text-left font-medium text-gray-900 hover:underline dark:text-gray-100"
                        title={t('egCopyAddress')}
                      >
                        {a.address}
                      </button>
                      {a.label && <span className="block text-xs text-gray-500 dark:text-gray-400">{a.label}</span>}
                      {/* The columns hidden on narrow screens fold in here rather
                          than truncating — a sport admin on a phone still needs
                          to know which section an address belongs to. */}
                      <span className="mt-0.5 block text-xs text-gray-500 md:hidden dark:text-gray-400">
                        {t(`egSport_${a.sport}`)} · {t(`egProvider_${a.provider}`)}
                      </span>
                      {!a.is_active && (
                        <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-400">{t('egInactive')}</span>
                      )}
                    </TableCell>

                    <TableCell className="hidden md:table-cell whitespace-normal align-top text-gray-700 dark:text-gray-300">
                      {t(`egSport_${a.sport}`)}
                    </TableCell>

                    <TableCell className="hidden lg:table-cell whitespace-normal align-top text-gray-700 dark:text-gray-300">
                      {t(`egProvider_${a.provider}`)}
                      {a.migadu_managed && (
                        <span className="block text-xs text-gray-400 dark:text-gray-500">
                          {a.last_seen_at ? t('egSeen', { when: formatDateTimeCompact(a.last_seen_at) }) : t('egSynced')}
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="align-top">
                      {!a.has_password ? (
                        <span className="text-sm text-gray-400 dark:text-gray-500">{t('egNoPassword')}</span>
                      ) : (
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
                          <button
                            type="button"
                            onClick={() => reveal(a)}
                            disabled={revealing === a.id || data?.vault_configured === false}
                            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 sm:min-h-0 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                          >
                            {plain !== undefined ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            {plain !== undefined ? t('egHide') : t('egReveal')}
                          </button>
                          {plain !== undefined && (
                            <>
                              <code className="select-all break-all rounded bg-gray-100 px-2 py-1 font-mono text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100">
                                {plain}
                              </code>
                              <button
                                type="button"
                                onClick={() => copy(a, plain)}
                                className="flex min-h-[44px] items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 sm:min-h-0 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                              >
                                {copied === a.id ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                                {copied === a.id ? t('egCopied') : t('egCopy')}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="hidden xl:table-cell whitespace-normal break-words align-top text-gray-500 dark:text-gray-400">
                      {a.notes || '–'}
                    </TableCell>

                    {canEdit && (
                      <TableCell className="align-top text-right">
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                          <button
                            type="button"
                            onClick={() => setEditing(a)}
                            aria-label={t('egEdit')}
                            className="flex h-11 w-11 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 sm:h-8 sm:w-8 dark:text-gray-400 dark:hover:bg-gray-700"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(a)}
                            aria-label={t('egDelete')}
                            className="flex h-11 w-11 items-center justify-center rounded-md text-red-600 hover:bg-red-50 sm:h-8 sm:w-8 dark:text-red-400 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <AccountDialog
          account={editing === 'new' ? null : editing}
          vaultConfigured={data?.vault_configured !== false}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </div>
  )
}

// ── Add / edit dialog ────────────────────────────────────────────

function AccountDialog({ account, vaultConfigured, onClose, onSaved }: {
  account: EmailAccount | null
  vaultConfigured: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation('admin')
  const isNew = account === null

  const [address, setAddress] = useState(account?.address ?? '')
  const [label, setLabel] = useState(account?.label ?? '')
  const [sport, setSport] = useState<Sport>(account?.sport ?? 'club')
  const [provider, setProvider] = useState<Provider>(account?.provider ?? 'migadu')
  const [notes, setNotes] = useState(account?.notes ?? '')
  const [isActive, setIsActive] = useState(account?.is_active ?? true)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  // On an edit, an untouched password box must mean "leave it alone", not
  // "clear it" — so the field is only sent when the user typed in it, and
  // clearing is the explicit button below.
  const [passwordTouched, setPasswordTouched] = useState(false)
  const [clearPassword, setClearPassword] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        address: address.trim(),
        label: label.trim() || null,
        sport,
        provider,
        notes: notes.trim() || null,
        is_active: isActive,
      }
      if (clearPassword) body.password = ''
      else if (passwordTouched && password) body.password = password

      if (isNew) await kscwApi('/email-accounts', { method: 'POST', body })
      else await kscwApi(`/email-accounts/${account.id}`, { method: 'PATCH', body })

      toast.success(t('egSaved'))
      onSaved()
    } catch (err) {
      const resp = (err as { body?: { error?: string } }).body
      toast.error(resp?.error || t('egSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? t('egAddTitle') : t('egEditTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="eg-address">{t('egFieldAddress')}</label>
            <input id="eg-address" type="email" value={address} onChange={(e) => setAddress(e.target.value)} className={field} />
          </div>

          <div>
            <label className={labelCls} htmlFor="eg-label">{t('egFieldLabel')}</label>
            <input id="eg-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('egFieldLabelPlaceholder')} className={field} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="eg-sport">{t('egFieldSport')}</label>
              <select id="eg-sport" value={sport} onChange={(e) => setSport(e.target.value as Sport)} className={field}>
                {SPORTS.map((s) => <option key={s} value={s}>{t(`egSport_${s}`)}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('egFieldSportHint')}</p>
            </div>
            <div>
              <label className={labelCls} htmlFor="eg-provider">{t('egFieldProvider')}</label>
              <select id="eg-provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className={field}>
                {PROVIDERS.map((p) => <option key={p} value={p}>{t(`egProvider_${p}`)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="eg-password">{t('egFieldPassword')}</label>
            <div className="flex gap-2">
              <input
                id="eg-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="new-password"
                disabled={clearPassword || !vaultConfigured}
                onChange={(e) => { setPassword(e.target.value); setPasswordTouched(true) }}
                placeholder={isNew ? '' : t('egFieldPasswordKeep')}
                className={`${field} disabled:opacity-40`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('egHide') : t('egReveal')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {!vaultConfigured && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('egVaultMissing')}</p>}
            {!isNew && account.has_password && (
              <label className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
                {t('egFieldPasswordClear')}
              </label>
            )}
          </div>

          <div>
            <label className={labelCls} htmlFor="eg-notes">{t('egFieldNotes')}</label>
            <textarea id="eg-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t('egFieldActive')}
          </label>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t('egCancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !address.trim()}
            className="min-h-[44px] rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            {t('egSave')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
