import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Trash2, UserPlus, KeyRound, Pencil, StickyNote } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { kscwApi } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../../components/ui/command'
import { useConfirm, usePrompt } from '../../components/ConfirmProvider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'

/**
 * /admin/households — who may administer whose account (migration 348).
 *
 * ⚠ Superadmin only, enforced server-side in household.js. A household link is
 * privilege-bearing: it lets one login write another member's record through the
 * acting-member swap. Sport Admin and Vorstand hold READ on the underlying
 * collections for oversight but cannot create a link.
 *
 * ⚠ Links are revoked, never deleted — the history of who could act for a minor
 * IS the record, so the table shows revoked rows greyed rather than hiding them.
 *
 * Uses <Table> per the lists-are-tables rule: these are homogeneous records an
 * admin scans and edits, not cards.
 */

interface HouseholdRow {
  id: number
  household: number
  member: number
  role: 'guardian' | 'managed'
  accent: string | null
  linked_at: string
  revoked_at: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  user_status: string | null
  login_email: string | null
  managed: boolean
  /** Server verdict: a managed row whose login is a draft, password-less
   *  shadow — the only kind the switcher and the middleware accept. */
  actable: boolean
  /** Why a managed row is not actable: 'not_provisioned' (no shadow login yet,
   *  or a broken one) or 'member_is_staff' (became coach / finance / planner…
   *  after the link — the middleware refuses her). null when actable. */
  not_actable_reason?: string | null
  linked_by_first: string | null
  linked_by_last: string | null
}

interface Household {
  id: number
  name: string
  notes: string | null
  members: HouseholdRow[]
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('de-CH') : '—'

type Adding = { household: number; role: 'guardian' | 'managed'; exclude: Set<number> }

/** GET /household/candidates?role= — who may be linked in that role, with the
 *  server's verdict. The server decides eligibility (same checks the POST
 *  applies), the picker only shows it. */
interface Candidate {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
  birthdate: string | null
  register_status: string | null
  eligible: boolean
  reason: string | null
}

type ApiErr = { code?: string; body?: { error?: unknown } }

/**
 * Turn a household endpoint refusal into a translated sentence. The server's
 * `code` maps onto `admin:householdErr_<code>`; an unknown code falls back to
 * the server's own `error` text, then to the generic error. Never `err.message`
 * — that is "API /household/…: 400", which tells an admin nothing.
 */
function useHouseholdErrorText() {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const reasonText = (code: string | null | undefined): string | null => {
    if (!code) return null
    // The DELETE refusal has shipped under two codes; both mean the same.
    const norm = code === 'household_has_history' ? 'household_not_empty' : code
    const key = `admin:householdErr_${norm}`
    return i18n.exists(key) ? t(key) : null
  }
  const errorText = (err: unknown): string => {
    const e = (err ?? {}) as ApiErr
    const byCode = reasonText(e.code)
    if (byCode) return byCode
    const bodyErr = e.body?.error
    if (typeof bodyErr === 'string' && bodyErr.trim()) return bodyErr
    return t('common:error')
  }
  return { reasonText, errorText }
}

/**
 * Pick the member to link — by name, like every other member picker, instead of
 * typing a raw id. The list comes from GET /household/candidates, which also
 * returns people who are not club members (a parent who does not play is a
 * "Kein Mitglied" row) and a managed child without a login. Ineligible people
 * are listed but disabled, with the reason, so an admin sees WHY instead of
 * getting a refusal after picking. Email + birth year disambiguate same-named
 * siblings / parents.
 *
 * The dialog stays open while the link is saved and shows a refusal inside it.
 * After a success it moves on instead of closing — main account → linked
 * members, one after another — so a family is set up in one sitting; "Done"
 * (or Esc) closes it.
 */
function MemberSearchDialog({ adding, pending, error, onClose, onPick }: {
  adding: Adding | null
  pending: boolean
  error: string | null
  onClose: () => void
  onPick: (member: Candidate) => void
}) {
  const { t } = useTranslation(['admin', 'common'])
  const { reasonText } = useHouseholdErrorText()
  const role = adding?.role
  const { data, isLoading, isError } = useQuery({
    queryKey: ['households', 'candidates', role],
    queryFn: () => kscwApi<{ data: Candidate[] }>(`/household/candidates?role=${role}`).then((r) => r.data ?? []),
    enabled: !!role,
  })
  const candidates = (data ?? []).filter((m) => !adding?.exclude.has(Number(m.id)))
  return (
    <Dialog open={!!adding} onOpenChange={(o) => { if (!o && !pending) onClose() }}>
      <DialogContent className="p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>
            {role === 'guardian' ? t('admin:householdAddGuardian') : t('admin:householdAddManaged')}
          </DialogTitle>
          <DialogDescription>{t('admin:householdMemberSearchHint')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="mx-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive dark:text-red-400">
            {error}
          </p>
        )}
        <Command className="border-t">
          <CommandInput placeholder={t('admin:householdMemberSearch')} autoFocus disabled={pending} />
          <CommandList className="max-h-80">
            {isLoading && <p className="px-3 py-4 text-sm text-muted-foreground">{t('common:loading')}</p>}
            {isError && <p className="px-3 py-4 text-sm text-destructive dark:text-red-400">{t('common:error')}</p>}
            {!isLoading && !isError && <CommandEmpty>{t('admin:householdMemberNoMatch')}</CommandEmpty>}
            {candidates.map((m) => {
              const reason = m.eligible ? null : (reasonText(m.reason) ?? t('admin:householdCandidateIneligible'))
              return (
                <CommandItem
                  key={m.id}
                  value={`${m.last_name ?? ''} ${m.first_name ?? ''} ${m.email ?? ''} ${m.id}`}
                  disabled={!m.eligible || pending}
                  onSelect={() => { if (m.eligible && !pending) onPick(m) }}
                  className="min-h-11 flex-wrap"
                >
                  <span className="font-medium">{m.last_name} {m.first_name}</span>
                  {m.birthdate && <span className="text-xs text-muted-foreground">{String(m.birthdate).slice(0, 4)}</span>}
                  {role === 'guardian' && m.register_status && (
                    <Badge variant="outline" className="text-[10px]">{m.register_status}</Badge>
                  )}
                  <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">{m.email}</span>
                  {reason && (
                    <span className="basis-full text-xs text-amber-700 dark:text-amber-400">{reason}</span>
                  )}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
        <div className="flex justify-end border-t px-4 py-3">
          <Button variant="outline" onClick={onClose} disabled={pending} className="min-h-11 sm:min-h-9">
            {t('admin:householdPickerDone')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function HouseholdsPage() {
  const { t } = useTranslation(['admin', 'common'])
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { errorText } = useHouseholdErrorText()
  const queryClient = useQueryClient()
  const { refreshUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<Adding | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['households', 'list'],
    queryFn: () => kscwApi<{ data: Household[] }>('/household').then((r) => r.data ?? []),
  })

  // After anything that changes who is linked: the picker's candidate verdicts
  // are stale (they are cached per role), and if the admin just linked HERSELF
  // her own switcher should appear now, not at the next 5-minute refresh.
  const afterLinkChange = () => {
    void queryClient.invalidateQueries({ queryKey: ['households', 'candidates'] })
    void refreshUser()
  }

  const run = async (fn: () => Promise<unknown>, { linksChanged = false } = {}) => {
    setBusy(true)
    try {
      await fn()
      if (linksChanged) afterLinkChange()
      await refetch()
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const createHousehold = async () => {
    const name = await prompt({ message: t('admin:householdNamePrompt') })
    if (!name?.trim()) return
    const created: { id: number | null } = { id: null }
    await run(async () => {
      const r = await kscwApi<{ data: { id: number } }>('/household', { method: 'POST', body: { name: name.trim() } })
      created.id = r?.data?.id ?? null
      toast.success(t('admin:householdCreated'))
    })
    // Straight on to the main account — no hunting for the new section.
    if (created.id != null) {
      setLinkError(null)
      setAdding({ household: created.id, role: 'guardian', exclude: new Set() })
    }
  }

  const renameHousehold = async (h: Household) => {
    const name = await prompt({ message: t('admin:householdRenamePrompt'), defaultValue: h.name })
    if (!name?.trim() || name.trim() === h.name) return
    await run(async () => {
      await kscwApi(`/household/${h.id}`, { method: 'PATCH', body: { name: name.trim() } })
      toast.success(t('admin:householdRenamed'))
    })
  }

  const editNotes = async (h: Household) => {
    const notes = await prompt({ message: t('admin:householdNotesPrompt'), defaultValue: h.notes ?? '' })
    if (notes === null || notes === undefined) return
    if (notes.trim() === (h.notes ?? '').trim()) return
    await run(async () => {
      await kscwApi(`/household/${h.id}`, { method: 'PATCH', body: { notes: notes.trim() || null } })
      toast.success(t('admin:householdNotesSaved'))
    })
  }

  const deleteHousehold = async (h: Household) => {
    if (!(await confirm({ message: t('admin:householdDeleteConfirm', { name: h.name }), danger: true }))) return
    await run(async () => {
      await kscwApi(`/household/${h.id}`, { method: 'DELETE' })
      toast.success(t('admin:householdDeleted'))
    })
  }

  const addMember = (h: Household, role: 'guardian' | 'managed') => {
    // Already-linked (not revoked) members are hidden from the search.
    setLinkError(null)
    setAdding({ household: h.id, role, exclude: new Set(h.members.filter((r) => !r.revoked_at).map((r) => r.member)) })
  }

  const closePicker = () => {
    setAdding(null)
    setLinkError(null)
  }

  // ⚠ Not `run()`: the dialog must stay open until the link is saved, and a
  // refusal is shown INSIDE it — a toast behind a closed dialog made the admin
  // re-open the picker and search again to try another person.
  const linkPicked = async (m: Candidate) => {
    if (!adding || busy) return
    const { household, role } = adding
    setBusy(true)
    setLinkError(null)
    try {
      await kscwApi(`/household/${household}/members`, { method: 'POST', body: { member: Number(m.id), role } })
      toast.success(t('admin:householdLinked'))
      // Keep going: after the main account, pick the linked members one by
      // one without reopening the picker. The just-linked member drops out.
      setAdding({ household, role: 'managed', exclude: new Set([...adding.exclude, Number(m.id)]) })
      afterLinkChange()
      await refetch()
    } catch (err) {
      setLinkError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const provision = async (household: number, member: number, name: string) => {
    if (!(await confirm({ message: t('admin:householdProvisionConfirm', { name }) }))) return
    await run(async () => {
      await kscwApi(`/household/${household}/members/${member}/provision`, { method: 'POST' })
      toast.success(t('admin:householdProvisioned', { name }))
    }, { linksChanged: true })
  }

  const revoke = async (household: number, row: HouseholdRow) => {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ')
    if (!(await confirm({ message: t('admin:householdRevokeConfirm', { name }), danger: true }))) return
    await run(async () => {
      await kscwApi(`/household/${household}/members/${row.id}`, { method: 'DELETE' })
      toast.success(t('admin:householdRevoked'))
    }, { linksChanged: true })
  }

  const households = data ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('admin:householdsTitle')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('admin:householdsIntro')}</p>
        </div>
        <Button onClick={() => { void createHousehold() }} disabled={busy} className="min-h-11 sm:min-h-9">
          <Plus className="mr-1.5 h-4 w-4" />{t('admin:householdNew')}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t('common:loading')}</p>}
      {!isLoading && households.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('admin:householdsEmpty')}</p>
      )}

      {households.map((h) => {
        // Revoked links are still returned, so an empty list means the household
        // NEVER had anyone in it — the only case the server lets us delete (a
        // delete would CASCADE away the history of who could act for a minor).
        const neverUsed = h.members.length === 0
        return (
        <section key={h.id} className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h2 className="break-words text-lg font-semibold text-foreground">{h.name}</h2>
                <Button size="sm" variant="ghost" disabled={busy}
                  className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                  aria-label={t('admin:householdRename')} title={t('admin:householdRename')}
                  onClick={() => { void renameHousehold(h) }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                {neverUsed && (
                  <Button size="sm" variant="ghost" disabled={busy}
                    className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                    aria-label={t('admin:householdDelete')} title={t('admin:householdDelete')}
                    onClick={() => { void deleteHousehold(h) }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
              <button type="button" disabled={busy}
                onClick={() => { void editNotes(h) }}
                className="mt-0.5 flex min-h-11 items-center gap-1.5 text-left text-sm text-muted-foreground hover:text-foreground sm:min-h-0">
                <StickyNote className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-pre-wrap break-words">{h.notes?.trim() || t('admin:householdNotesAdd')}</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => addMember(h, 'guardian')} disabled={busy} className="min-h-11 sm:min-h-8">
                <UserPlus className="mr-1.5 h-4 w-4" />{t('admin:householdAddGuardian')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => addMember(h, 'managed')} disabled={busy} className="min-h-11 sm:min-h-8">
                <UserPlus className="mr-1.5 h-4 w-4" />{t('admin:householdAddManaged')}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:householdColMember')}</TableHead>
                  <TableHead>{t('admin:householdColRole')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('admin:householdColAccount')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('admin:householdColLinked')}</TableHead>
                  <TableHead className="text-right">{t('admin:householdColActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {neverUsed && (
                  <TableRow>
                    <TableCell colSpan={5} className="whitespace-normal py-4 text-center text-sm text-muted-foreground">
                      {t('admin:householdNoMembers')}
                    </TableCell>
                  </TableRow>
                )}
                {h.members.map((row) => {
                  const name = [row.last_name, row.first_name].filter(Boolean).join(' / ')
                  const revoked = !!row.revoked_at
                  // The server's `actable` flag is what the switcher and the
                  // middleware accept. A live managed row that is not actable
                  // either has no login yet ("Set up" provisions one) or holds
                  // a login that is not a draft password-less shadow ("Login
                  // broken" — provisioning refuses that, so no button). Said in
                  // the NAME cell — the Account column is hidden on mobile.
                  const notActable = !revoked && row.role === 'managed' && !row.actable
                  // Became staff after the link: the login is fine, but the
                  // middleware refuses to act as a coach / finance / planner.
                  const isStaff = notActable && row.not_actable_reason === 'member_is_staff'
                  const needsSetup = notActable && !isStaff && !row.login_email
                  const loginBroken = notActable && !isStaff && !!row.login_email
                  return (
                    <TableRow key={row.id} className={revoked ? 'opacity-50' : undefined}>
                      <TableCell className="whitespace-normal break-words font-medium">
                        {name}
                        <span className="block text-xs text-muted-foreground">#{row.member}</span>
                        {needsSetup && (
                          <Badge variant="outline" className="mt-1 border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-400">
                            {t('admin:householdSetupNeeded')}
                          </Badge>
                        )}
                        {isStaff && (
                          <Badge variant="outline" className="mt-1 border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-400"
                            title={t('admin:householdErr_member_is_staff')}>
                            {t('admin:householdNotActable')}
                          </Badge>
                        )}
                        {isStaff && (
                          <span className="block text-xs text-muted-foreground">{t('admin:householdErr_member_is_staff')}</span>
                        )}
                        {loginBroken && (
                          <Badge variant="outline" className="mt-1 border-destructive text-destructive dark:border-red-400 dark:text-red-400"
                            title={t('admin:householdLoginBrokenHint')}>
                            {t('admin:householdLoginBroken')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Badge variant={row.role === 'guardian' ? 'default' : 'secondary'}>
                          {row.role === 'guardian' ? t('admin:householdRoleGuardian') : t('admin:householdRoleManaged')}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden whitespace-normal break-words text-xs sm:table-cell">
                        {row.managed
                          ? <span className="text-muted-foreground">{t('admin:householdNoLogin')}</span>
                          : row.login_email
                            ? <span>{row.login_email}</span>
                            : <span className="text-amber-600 dark:text-amber-400">{t('admin:householdNoAccount')}</span>}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                        {fmt(row.linked_at)}
                        {revoked && <span className="block">{t('admin:householdRevokedOn', { date: fmt(row.revoked_at) })}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {!revoked && (
                          <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                            {needsSetup && (
                              <Button size="sm" variant="outline" disabled={busy} className="min-h-11 sm:min-h-8"
                                onClick={() => { void provision(h.id, row.member, row.first_name || name) }}>
                                <KeyRound className="mr-1.5 h-4 w-4" />{t('admin:householdProvision')}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={busy} className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                              aria-label={t('admin:householdRevoke')} title={t('admin:householdRevoke')}
                              onClick={() => { void revoke(h.id, row) }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
        )
      })}

      <MemberSearchDialog
        adding={adding}
        pending={busy}
        error={linkError}
        onClose={closePicker}
        onPick={(m) => { void linkPicked(m) }}
      />
    </div>
  )
}
