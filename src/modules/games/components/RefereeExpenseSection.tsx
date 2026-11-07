import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, ChevronDown, Pencil, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import IconButton from '@/components/IconButton'
import type { RefereeExpense, Member, Team, BaseRecord } from '../../../types'
import { useTeamMembers } from '../../../hooks/useTeamMembers'
import { useMutation } from '../../../hooks/useMutation'
import { useAuth } from '../../../hooks/useAuth'
import SearchableSelect from '../../../components/ui/SearchableSelect'
import { fetchItems, fetchItem } from '../../../lib/api'
import { toNum, formatChf } from '../../../hooks/useFinance'
import { asObj, memberDisplayName } from '../../../utils/relations'
import {
  formatAmountInput,
  gboRefereeFee,
  planRefereeExpenseSave,
  splitEvenly,
  sumChf,
  type RefereeShare,
} from '../utils/refereeFee'

interface RefereeExpenseSectionProps {
  gameId: string
  teamId: string
  /** `games.league`: prices a new fee from the GBO table. */
  league?: string | null
  /** How many referees the game lists; the GBO price is per referee. */
  refereeCount?: number | null
  canEdit: boolean
  /** Fires after a successful create/update — a host that shows the fee
   *  elsewhere on the page (Team finance table + tiles) refetches on it. */
  onSaved?: () => void
  /** Start expanded (the Home nudge's "Record now" deep-link). Read once, on mount. */
  defaultOpen?: boolean
}

type ExpandedExpense = RefereeExpense & {
  paid_by_member: (Member & BaseRecord) | string
}

/** One person's line in the form. `amount` is only read once the fee is split. */
interface ShareDraft {
  key: number
  paidBy: string
  otherName: string
  amount: string
}

const OTHER_VALUE = '__other__'

const inputCls = 'h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 dark:bg-input/20'

let shareKeySeq = 0
const newShare = (paidBy = '', otherName = '', amount = ''): ShareDraft => ({ key: ++shareKeySeq, paidBy, otherName, amount })

const fetchRows = (gameId: string) =>
  fetchItems<ExpandedExpense>('referee_expenses', {
    filter: { game: { _eq: gameId } },
    fields: ['*', 'paid_by_member.*'],
    sort: ['id'],
    limit: -1,
  })

function rowMemberId(row: ExpandedExpense): string {
  const member = asObj<Member & BaseRecord>(row.paid_by_member)
  if (member) return String(member.id ?? '')
  return row.paid_by_member ? String(row.paid_by_member) : ''
}

function rowPayerName(row: ExpandedExpense): string {
  const member = asObj<Member & BaseRecord>(row.paid_by_member)
  return member ? memberDisplayName(member) : row.paid_by_other || ''
}

/** What a stale form must not overwrite: who paid, and how much. */
const rowsSignature = (rows: ExpandedExpense[]) =>
  rows.map((r) => `${r.id}|${rowMemberId(r)}|${r.paid_by_other ?? ''}|${toNum(r.amount)}`).join('\n')

/** The people as they stand, with the total shared evenly between them. */
function spreadTotal(shares: ShareDraft[], total: string): ShareDraft[] {
  const value = parseFloat(total)
  const amounts = value > 0 ? splitEvenly(value, shares.length).map(formatAmountInput) : shares.map(() => '')
  return shares.map((s, i) => ({ ...s, amount: amounts[i] }))
}

export default function RefereeExpenseSection({ gameId, teamId, league, refereeCount, canEdit, defaultOpen, onSaved }: RefereeExpenseSectionProps) {
  const { t, i18n } = useTranslation('games')
  const { user, isApproved } = useAuth()
  const { members } = useTeamMembers(teamId)
  const { create, update, remove } = useMutation<RefereeExpense>('referee_expenses')

  const [rows, setRows] = useState<ExpandedExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [coaches, setCoaches] = useState<(Member & BaseRecord)[]>([])
  const [open, setOpen] = useState(defaultOpen ?? false)

  // Form state. `total` is null until someone touches the fee of a game with no
  // record yet: that is what lets the GBO price show without overwriting a value.
  const [shares, setShares] = useState<ShareDraft[]>(() => [newShare()])
  const [total, setTotal] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

  const gbo = useMemo(() => gboRefereeFee(league, refereeCount), [league, refereeCount])
  const totalValue = total ?? (gbo ? String(gbo.total) : '')

  const loadForm = useCallback((records: ExpandedExpense[]) => {
    if (records.length === 0) {
      setShares([newShare()])
      setTotal(null)
      setNotes('')
      return
    }
    setShares(records.map((r) => {
      const memberId = rowMemberId(r)
      return newShare(memberId || (r.paid_by_other ? OTHER_VALUE : ''), r.paid_by_other || '', formatAmountInput(toNum(r.amount)))
    }))
    setTotal(formatAmountInput(sumChf(records.map((r) => r.amount))))
    setNotes(records.find((r) => r.notes)?.notes || '')
  }, [])

  // `loading` is a pure function of the fetch trigger — true while a fetch is in
  // flight for the current (gameId, teamId, user, isApproved) tuple, false when
  // there is nothing to fetch. Primed during render (adjust-state-during-render)
  // on exactly the effect's dep tuple, so the effect below carries no synchronous
  // setState (react-hooks/set-state-in-effect). `null` seeds a first pass on
  // mount, matching the effect's mount run; the fetch itself is unchanged.
  const [primedFor, setPrimedFor] = useState<
    { gameId: string; teamId: string; user: typeof user; isApproved: boolean } | null
  >(null)
  if (
    !primedFor ||
    primedFor.gameId !== gameId ||
    primedFor.teamId !== teamId ||
    primedFor.user !== user ||
    primedFor.isApproved !== isApproved
  ) {
    setPrimedFor({ gameId, teamId, user, isApproved })
    setLoading(!!user && !!isApproved)
  }

  // Fetch existing record + coaches (who may not be team members)
  useEffect(() => {
    // Skip when unauthenticated / role still pending — they have no read permission
    // on referee_expenses and the fetch would just produce Sentry noise.
    if (!user || !isApproved) return
    let cancelled = false

    const fetchExpense = fetchRows(gameId)
      .then((records) => {
        if (cancelled) return
        setRows(records)
        loadForm(records)
      })
      .catch(() => {
        if (cancelled) return
        setRows([])
        loadForm([])
      })

    // CRITICAL: coach/team_responsible are M2M aliases — `coach.*` returns the
    // junction rows (teams_coaches), NOT members, so first_name/last_name are
    // undefined (the "undefined undefined" dropdown entries). Expand through
    // `members_id.*` and pull the member object out of each junction row.
    const fetchCoaches = fetchItem<Team & BaseRecord>(
        'teams', teamId, { fields: ['id', 'coach.members_id.*', 'team_responsible.members_id.*'] }
      )
      .then((team) => {
        if (cancelled) return
        const t = team as Team & BaseRecord & { coach?: unknown[]; team_responsible?: unknown[] }
        const extractMembers = (junctions: unknown): (Member & BaseRecord)[] =>
          (Array.isArray(junctions) ? junctions : [])
            .map((j) => asObj<Member & BaseRecord>((j as { members_id?: (Member & BaseRecord) | string })?.members_id))
            .filter((m): m is Member & BaseRecord => m != null && !!m.id)
        const all = [...extractMembers(t.coach), ...extractMembers(t.team_responsible)]
        // Deduplicate by id
        const seen = new Set<string>()
        setCoaches(all.filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true }))
      })
      .catch(() => {})

    Promise.allSettled([fetchExpense, fetchCoaches]).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [gameId, teamId, user, isApproved, loadForm])

  // Build member options: team roster + coaches/team responsibles (deduplicated)
  const memberOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: { value: string; label: string }[] = []

    // Add roster members
    for (const mt of members) {
      const m = typeof mt.member === 'object' ? mt.member : null
      if (!m || seen.has(m.id)) continue
      seen.add(m.id)
      options.push({ value: m.id, label: memberDisplayName(m) })
    }

    // Add coaches/team responsibles not already in roster
    for (const m of coaches) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      options.push({ value: m.id, label: memberDisplayName(m) })
    }

    options.sort((a, b) => a.label.localeCompare(b.label, i18n.language))
    options.push({ value: OTHER_VALUE, label: t('refereeExpensesOtherPerson') })
    return options
  }, [members, coaches, t])

  const isSplit = shares.length > 1

  const changeTotal = (value: string) => {
    setTotal(value)
    setShares((current) => spreadTotal(current, value))
  }

  const changeShareAmount = (key: number, value: string) => {
    const next = shares.map((s) => (s.key === key ? { ...s, amount: value } : s))
    setShares(next)
    setTotal(formatAmountInput(sumChf(next.map((s) => s.amount))))
  }

  const changeShare = (key: number, patch: Partial<ShareDraft>) =>
    setShares((current) => current.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  // Adding or removing someone shares the total evenly again. `totalValue` also
  // pins a prefilled amount that nobody has typed over.
  const addPerson = () => {
    setTotal(totalValue)
    setShares(spreadTotal([...shares, newShare()], totalValue))
  }

  const removePerson = (key: number) => {
    setTotal(totalValue)
    setShares(spreadTotal(shares.filter((s) => s.key !== key), totalValue))
  }

  // A member already on another line cannot be picked twice. "Other person" can,
  // with a different name.
  const optionsFor = (share: ShareDraft) =>
    memberOptions.filter((o) =>
      o.value === OTHER_VALUE || o.value === share.paidBy || !shares.some((s) => s.paidBy === o.value))

  const otherNames = shares.filter((s) => s.paidBy === OTHER_VALUE).map((s) => s.otherName.trim().toLowerCase())
  const canSave = !saving
    && shares.every((s) => s.paidBy && (s.paidBy !== OTHER_VALUE || s.otherName.trim()))
    && new Set(otherNames).size === otherNames.length

  const handleSave = async () => {
    setSaving(true)
    try {
      // Someone else may have recorded this game while the form sat open. Writing
      // on top could pay the fee twice, and no index refuses that now that a game
      // holds several rows, so check right before the first write.
      const latest = await fetchRows(gameId)
      if (rowsSignature(latest) !== rowsSignature(rows)) {
        setRows(latest)
        loadForm(latest)
        setEditing(false)
        toast.error(t('refereeExpensesChangedElsewhere'))
        return
      }

      const toSave: RefereeShare[] = shares.map((s) => {
        const isOther = s.paidBy === OTHER_VALUE
        return {
          member: isOther ? null : s.paidBy,
          other: isOther ? s.otherName.trim() : null,
          amount: parseFloat(isSplit ? s.amount : totalValue) || 0,
        }
      })
      const payload = (share: RefereeShare): Record<string, unknown> => ({
        game: gameId,
        team: teamId,
        paid_by_member: share.member,
        paid_by_other: share.other ?? '',
        amount: share.amount,
        notes,
        recorded_by: user?.id || '',
      })
      const plan = planRefereeExpenseSave(
        rows.map((r) => ({ id: String(r.id), member: rowMemberId(r) || null, other: r.paid_by_other || null })),
        toSave,
      )
      for (const { id, share } of plan.update) await update(id, payload(share))
      for (const share of plan.create) await create(payload(share))
      for (const id of plan.remove) await remove(id)

      const fresh = await fetchRows(gameId)
      setRows(fresh)
      loadForm(fresh)
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.()
    } catch {
      toast.error(t('common:error'))
      // The writes are separate requests, so some may have landed. The form stays
      // as typed, and saving again works out the difference from what is stored.
      await fetchRows(gameId).then(setRows).catch(() => {})
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  const hasRecord = rows.length > 0
  const isFormMode = (!hasRecord && canEdit) || editing
  // Once finance has settled a row in a season-end payout run (migration 363:
  // `payout` = finance_payouts FK) the amount is what was reimbursed — editing it
  // would desync the books. Frozen for everyone, admins included, and for the
  // whole game: the shares only add up as a set.
  // toNum: the FK arrives as a numeric string through fetchItems.
  const reimbursed = rows.some((r) => toNum(r.payout) > 0)
  const paidByNames = rows.map(rowPayerName).filter(Boolean).join(', ')
  const totalAmount = sumChf(rows.map((r) => r.amount))

  // Collapsed by default; open on click, or stay open while editing an existing record
  const effectiveOpen = open || editing

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t('refereeExpenses')}
          {hasRecord && !effectiveOpen && (
            <span className="ml-2 normal-case font-normal text-muted-foreground/80">— {paidByNames}</span>
          )}
        </h4>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white shadow-lg animate-fade-in">
              <Check className="h-3 w-3" />
              {t('refereeExpensesSaved')}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground/80 transition-transform ${effectiveOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {!effectiveOpen ? null : isFormMode ? (
        <div className="space-y-3">
          <div>
            {isSplit && <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('refereeExpensesPaidBy')}</p>}
            <div className={isSplit ? 'space-y-3' : 'space-y-2'}>
              {shares.map((share, i) => (
                <div
                  key={share.key}
                  role={isSplit ? 'group' : undefined}
                  aria-label={isSplit ? t('refereeExpensesPerson', { n: i + 1 }) : undefined}
                  className="space-y-2"
                >
                  {isSplit ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                        <SearchableSelect
                          options={optionsFor(share)}
                          value={share.paidBy}
                          onChange={(paidBy) => changeShare(share.key, { paidBy })}
                          placeholder="—"
                        />
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="0.05"
                        value={share.amount}
                        onChange={(e) => changeShareAmount(share.key, e.target.value)}
                        placeholder="0.00"
                        aria-label={t('refereeExpensesShare')}
                        className={`${inputCls} min-w-0 flex-1 tabular-nums sm:w-24 sm:flex-none`}
                      />
                      <IconButton
                        label={t('refereeExpensesRemovePerson')}
                        onClick={() => removePerson(share.key)}
                        className="shrink-0 text-muted-foreground"
                      >
                        <X />
                      </IconButton>
                    </div>
                  ) : (
                    <SearchableSelect
                      label={t('refereeExpensesPaidBy')}
                      options={optionsFor(share)}
                      value={share.paidBy}
                      onChange={(paidBy) => changeShare(share.key, { paidBy })}
                      placeholder="—"
                    />
                  )}

                  {share.paidBy === OTHER_VALUE && (
                    <input
                      type="text"
                      value={share.otherName}
                      onChange={(e) => changeShare(share.key, { otherName: e.target.value })}
                      placeholder={t('refereeExpensesOtherName')}
                      aria-label={t('refereeExpensesOtherName')}
                      className={`${inputCls} sm:h-9`}
                    />
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" icon={<UserPlus />} onClick={addPerson}>
                {isSplit ? t('refereeExpensesSplitAddMore') : t('refereeExpensesSplitAdd')}
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {isSplit ? t('refereeExpensesTotal') : t('refereeExpensesAmount')}
              <input
                type="number"
                min="0"
                step="0.05"
                value={totalValue}
                onChange={(e) => changeTotal(e.target.value)}
                placeholder="0.00"
                className={`${inputCls} mt-1.5 font-normal tabular-nums sm:h-9`}
              />
            </label>
            {gbo && (
              <p className="text-xs text-muted-foreground">
                {t('refereeExpensesGboHint', {
                  count: gbo.referees,
                  fee: gbo.feePerReferee,
                  travel: gbo.travelPerReferee,
                  total: gbo.total,
                })}
              </p>
            )}
            {isSplit && <p className="mt-1 text-xs text-muted-foreground">{t('refereeExpensesSplitHint')}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('refereeExpensesNotes')}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('refereeExpensesNotes')}
              className={`${inputCls} sm:h-9`}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={!canSave} loading={saving}>
              {t('refereeExpensesSave')}
            </Button>
            {editing && (
              <IconButton
                label={t('common:cancel')}
                onClick={() => {
                  setEditing(false)
                  loadForm(rows)
                }}
                className="text-muted-foreground"
              >
                <X />
              </IconButton>
            )}
          </div>
        </div>
      ) : hasRecord ? (
        <div className="space-y-2">
          {rows.length > 1 ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">{t('refereeExpensesPaidBy')}</p>
              {rows.map((r) => (
                <div key={r.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words text-foreground">{rowPayerName(r)}</span>
                  <span className="shrink-0 tabular-nums text-foreground">{formatChf(r.amount)}</span>
                </div>
              ))}
              {totalAmount > 0 && (
                <div className="flex items-baseline justify-between gap-3 border-t border-border/70 pt-1">
                  <span className="text-muted-foreground">{t('refereeExpensesTotal')}</span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">{formatChf(totalAmount)}</span>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">{t('refereeExpensesPaidBy')}</span>
                <span className="min-w-0 break-words text-foreground">{paidByNames}</span>
              </div>
              {totalAmount > 0 && (
                <div className="flex items-start gap-3 text-sm">
                  <span className="w-28 shrink-0 text-muted-foreground">{t('refereeExpensesAmount')}</span>
                  <span className="tabular-nums text-foreground">{formatChf(totalAmount)}</span>
                </div>
              )}
            </>
          )}
          {notes && (
            <div className="flex items-start gap-3 text-sm">
              <span className="w-28 shrink-0 text-muted-foreground">{t('refereeExpensesNotes')}</span>
              <span className="min-w-0 break-words text-foreground">{notes}</span>
            </div>
          )}
          {reimbursed ? (
            <p className="text-xs text-muted-foreground">{t('refereeExpensesReimbursed')}</p>
          ) : canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              icon={<Pencil />}
            >
              {t('refereeExpensesEdit')}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('refereeExpensesNotRecorded')}</p>
      )}
    </div>
  )
}
