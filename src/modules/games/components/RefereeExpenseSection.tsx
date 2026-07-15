import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Pencil } from 'lucide-react'
import type { RefereeExpense, Member, Team, BaseRecord } from '../../../types'
import { useTeamMembers } from '../../../hooks/useTeamMembers'
import { useMutation } from '../../../hooks/useMutation'
import { useAuth } from '../../../hooks/useAuth'
import SearchableSelect from '../../../components/ui/SearchableSelect'
import { fetchItems, fetchItem } from '../../../lib/api'
import { asObj, memberDisplayName } from '../../../utils/relations'

interface RefereeExpenseSectionProps {
  gameId: string
  teamId: string
  canEdit: boolean
}

type ExpandedExpense = RefereeExpense & {
  paid_by_member: (Member & BaseRecord) | string
}

const OTHER_VALUE = '__other__'

export default function RefereeExpenseSection({ gameId, teamId, canEdit }: RefereeExpenseSectionProps) {
  const { t, i18n } = useTranslation('games')
  const { user, isApproved } = useAuth()
  const { members } = useTeamMembers(teamId)
  const { create, update } = useMutation<RefereeExpense>('referee_expenses')

  const [existing, setExisting] = useState<ExpandedExpense | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [coaches, setCoaches] = useState<(Member & BaseRecord)[]>([])
  const [open, setOpen] = useState(false)

  // Form state
  const [paidBy, setPaidBy] = useState('')
  const [otherName, setOtherName] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')

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

    const fetchExpense = fetchItems<ExpandedExpense>('referee_expenses', {
        filter: { game: { _eq: gameId } },
        fields: ['*', 'paid_by_member.*'],
        limit: 1,
      })
      .then((records) => records[0])
      .then((record) => {
        if (!record) throw new Error('not found')
        if (cancelled) return
        setExisting(record)
        const paidByMemberId = typeof record.paid_by_member === 'string' ? record.paid_by_member : (asObj<Member & BaseRecord>(record.paid_by_member)?.id ?? '')
        setPaidBy(paidByMemberId || (record.paid_by_other ? OTHER_VALUE : ''))
        setOtherName(record.paid_by_other || '')
        setAmount(record.amount ? String(record.amount) : '')
        setNotes(record.notes || '')
      })
      .catch(() => {
        if (!cancelled) setExisting(null)
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
  }, [gameId, teamId, user, isApproved])

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

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      game: gameId,
      team: teamId,
      paid_by_member: paidBy === OTHER_VALUE ? '' : paidBy,
      paid_by_other: paidBy === OTHER_VALUE ? otherName : '',
      amount: amount ? parseFloat(amount) : 0,
      notes,
      recorded_by: user?.id || '',
    }

    try {
      if (existing) {
        const updated = await update(existing.id, data)
        // Re-fetch with expand for display
        const full = await fetchItem<ExpandedExpense>('referee_expenses', updated.id, { fields: ['*', 'paid_by_member.*'] })
        setExisting(full)
      } else {
        const created = await create(data)
        const full = await fetchItem<ExpandedExpense>('referee_expenses', created.id, { fields: ['*', 'paid_by_member.*'] })
        setExisting(full)
      }
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // Error is handled by useMutation
    }
  }

  if (loading) return null

  const isFormMode = (!existing && canEdit) || editing
  const paidByMemberObj = existing ? asObj<Member & BaseRecord>(existing.paid_by_member) : null
  const paidByName = paidByMemberObj
    ? memberDisplayName(paidByMemberObj)
    : existing?.paid_by_other || ''

  // Collapsed by default; open on click, or stay open while editing an existing record
  const effectiveOpen = open || editing

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t('refereeExpenses')}
          {existing && !effectiveOpen && (
            <span className="ml-2 normal-case font-normal text-gray-400 dark:text-gray-500">— {paidByName}</span>
          )}
        </h4>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white shadow-lg animate-fade-in">
              <Check className="h-3 w-3" />
              {t('refereeExpensesSaved')}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${effectiveOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {!effectiveOpen ? null : isFormMode ? (
        <div className="space-y-3">
          <SearchableSelect
            label={t('refereeExpensesPaidBy')}
            options={memberOptions}
            value={paidBy}
            onChange={setPaidBy}
            placeholder="—"
          />

          {paidBy === OTHER_VALUE && (
            <input
              type="text"
              value={otherName}
              onChange={(e) => setOtherName(e.target.value)}
              placeholder={t('refereeExpensesOtherName')}
              className="w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-400 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-brand-500"
            />
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('refereeExpensesAmount')}</label>
            <input
              type="number"
              min="0"
              step="0.05"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-400 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-brand-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">{t('refereeExpensesNotes')}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('refereeExpensesNotes')}
              className="w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-400 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-brand-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!paidBy || (paidBy === OTHER_VALUE && !otherName.trim())}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('refereeExpensesSave')}
            </button>
            {editing && (
              <button
                onClick={() => {
                  setEditing(false)
                  // Reset to existing values
                  if (existing) {
                    const memberId = typeof existing.paid_by_member === 'string' ? existing.paid_by_member : (asObj<Member & BaseRecord>(existing.paid_by_member)?.id ?? '')
                    setPaidBy(memberId || (existing.paid_by_other ? OTHER_VALUE : ''))
                    setOtherName(existing.paid_by_other || '')
                    setAmount(existing.amount ? String(existing.amount) : '')
                    setNotes(existing.notes || '')
                  }
                }}
                className="rounded-md px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                aria-label={t('common:cancel')}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ) : existing ? (
        <div className="space-y-2">
          <div className="flex items-start gap-3 text-sm">
            <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">{t('refereeExpensesPaidBy')}</span>
            <span className="text-gray-900 dark:text-gray-100">{paidByName}</span>
          </div>
          {existing.amount > 0 && (
            <div className="flex items-start gap-3 text-sm">
              <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">{t('refereeExpensesAmount')}</span>
              <span className="text-gray-900 dark:text-gray-100">CHF {existing.amount.toFixed(2)}</span>
            </div>
          )}
          {existing.notes && (
            <div className="flex items-start gap-3 text-sm">
              <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">{t('refereeExpensesNotes')}</span>
              <span className="text-gray-900 dark:text-gray-100">{existing.notes}</span>
            </div>
          )}
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 text-xs text-brand-600 hover:underline dark:text-brand-400"
            >
              <Pencil className="h-3 w-3" />
              {t('refereeExpensesEdit')}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('refereeExpensesNotRecorded')}</p>
      )}
    </div>
  )
}
