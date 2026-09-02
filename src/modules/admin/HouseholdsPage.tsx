import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Trash2, UserPlus, KeyRound } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { kscwApi } from '../../lib/api'
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

export default function HouseholdsPage() {
  const { t } = useTranslation(['admin', 'common'])
  const confirm = useConfirm()
  const prompt = usePrompt()
  const [busy, setBusy] = useState(false)

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['households', 'list'],
    queryFn: () => kscwApi<{ data: Household[] }>('/household').then((r) => r.data ?? []),
  })

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common:error'))
    } finally {
      setBusy(false)
    }
  }

  const createHousehold = async () => {
    const name = await prompt({ message: t('admin:householdNamePrompt') })
    if (!name?.trim()) return
    await run(async () => {
      await kscwApi('/household', { method: 'POST', body: { name: name.trim() } })
      toast.success(t('admin:householdCreated'))
    })
  }

  const addMember = async (household: number, role: 'guardian' | 'managed') => {
    const raw = await prompt({ message: t('admin:householdMemberIdPrompt') })
    const member = Number(raw)
    if (!Number.isInteger(member) || member <= 0) return
    await run(async () => {
      await kscwApi(`/household/${household}/members`, { method: 'POST', body: { member, role } })
      toast.success(t('admin:householdLinked'))
    })
  }

  const provision = async (household: number, member: number, name: string) => {
    if (!(await confirm({ message: t('admin:householdProvisionConfirm', { name }) }))) return
    await run(async () => {
      await kscwApi(`/household/${household}/members/${member}/provision`, { method: 'POST' })
      toast.success(t('admin:householdProvisioned', { name }))
    })
  }

  const revoke = async (household: number, row: HouseholdRow) => {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ')
    if (!(await confirm({ message: t('admin:householdRevokeConfirm', { name }), danger: true }))) return
    await run(async () => {
      await kscwApi(`/household/${household}/members/${row.id}`, { method: 'DELETE' })
      toast.success(t('admin:householdRevoked'))
    })
  }

  const households = data ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('admin:householdsTitle')}</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('admin:householdsIntro')}</p>
        </div>
        <Button onClick={() => { void createHousehold() }} disabled={busy}>
          <Plus className="mr-1.5 h-4 w-4" />{t('admin:householdNew')}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t('common:loading')}</p>}
      {!isLoading && households.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('admin:householdsEmpty')}</p>
      )}

      {households.map((h) => (
        <section key={h.id} className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-foreground">{h.name}</h2>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { void addMember(h.id, 'guardian') }} disabled={busy}>
                <UserPlus className="mr-1.5 h-4 w-4" />{t('admin:householdAddGuardian')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { void addMember(h.id, 'managed') }} disabled={busy}>
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
                {h.members.map((row) => {
                  const name = [row.last_name, row.first_name].filter(Boolean).join(' / ')
                  const revoked = !!row.revoked_at
                  return (
                    <TableRow key={row.id} className={revoked ? 'opacity-50' : undefined}>
                      <TableCell className="min-h-[44px] whitespace-normal break-words font-medium">
                        {name}
                        <span className="block text-xs text-muted-foreground">#{row.member}</span>
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
                            : <span className="text-amber-600">{t('admin:householdNoAccount')}</span>}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                        {fmt(row.linked_at)}
                        {revoked && <span className="block">{t('admin:householdRevokedOn', { date: fmt(row.revoked_at) })}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {!revoked && (
                          <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                            {row.role === 'managed' && !row.login_email && (
                              <Button size="sm" variant="outline" disabled={busy}
                                onClick={() => { void provision(h.id, row.member, row.first_name || name) }}>
                                <KeyRound className="mr-1.5 h-4 w-4" />{t('admin:householdProvision')}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={busy}
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
      ))}
    </div>
  )
}
