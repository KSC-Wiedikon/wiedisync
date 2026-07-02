import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCollection } from '../../../lib/query'
import { useMutation } from '../../../hooks/useMutation'
import { useAuth } from '../../../hooks/useAuth'
import { useRealtime } from '../../../hooks/useRealtime'
import { kscwApi } from '../../../lib/api'
import type { Poll, PollVote } from '../../../types'
import { relId, memberName } from '../../../utils/relations'

// Shared close/delete mutation scaffolding for the poll-list hooks
// (usePolls / useActivePolls) so the "update status → refetch" and
// "remove → refetch" wiring lives in one place instead of being copy-pasted.
function usePollActions(refetch: () => void) {
  const { update: updatePoll, remove: removePoll } = useMutation<Poll>('polls')

  const closePoll = useCallback(async (pollId: string) => {
    await updatePoll(pollId, { status: 'closed' })
    refetch()
  }, [updatePoll, refetch])

  const deletePoll = useCallback(async (pollId: string) => {
    await removePoll(pollId)
    refetch()
  }, [removePoll, refetch])

  return { closePoll, deletePoll }
}

export function usePolls(teamId: string) {
  const { user } = useAuth()

  const { data: pollsRaw, refetch: refetchPolls, isLoading } = useCollection<Poll>('polls', {
    filter: teamId ? { team: { _eq: teamId } } : { id: { _eq: -1 } },
    sort: ['-date_created'],
    all: true,
    enabled: !!teamId,
  })
  const polls = pollsRaw ?? []

  const { create: createPoll } = useMutation<Poll>('polls')
  const { closePoll, deletePoll } = usePollActions(refetchPolls)

  useRealtime<Poll>('polls', (e) => {
    if (e.record.team === teamId) refetchPolls()
  })

  const addPoll = useCallback(async (data: {
    question: string
    options: string[]
    mode: 'single' | 'multi'
    deadline?: string
    anonymous?: boolean
  }) => {
    if (!user) return
    await createPoll({
      team: teamId,
      question: data.question,
      options: data.options,
      mode: data.mode,
      deadline: data.deadline || '',
      anonymous: data.anonymous || false,
      created_by: user.id,
      status: 'open',
    })
    refetchPolls()
  }, [user, teamId, createPoll, refetchPolls])

  return { polls, isLoading, addPoll, closePoll, deletePoll }
}

// Open, still-actionable polls across several teams — used by the home-screen
// surveys widget so polls (which otherwise live only on the team page) are easy
// to find. Returns close/delete mutations so managers can act inline.
export function useActivePolls(teamIds: string[]) {
  const { data: pollsRaw, refetch, isLoading } = useCollection<Poll>('polls', {
    filter: teamIds.length > 0
      ? { _and: [{ team: { _in: teamIds } }, { status: { _eq: 'open' } }] }
      : { id: { _eq: -1 } },
    sort: ['-date_created'],
    all: true,
    enabled: teamIds.length > 0,
  })
  // The deadline doesn't auto-close a poll (status stays 'open'), so drop polls
  // whose deadline has passed — they're no longer actionable on the home screen.
  const polls = (pollsRaw ?? []).filter(p => !p.deadline || new Date(p.deadline) >= new Date())

  const { closePoll, deletePoll } = usePollActions(refetch)

  useRealtime<Poll>('polls', (e) => {
    if (e.record.team != null && teamIds.includes(String(e.record.team))) refetch()
  })

  return { polls, isLoading, closePoll, deletePoll, refetch }
}

export function usePollVotes(poll: Poll, canManage = false) {
  const pollId = poll.id
  const anonymous = !!poll.anonymous
  const { user } = useAuth()

  const { data: votesRaw, refetch, isLoading } = useCollection<PollVote>('poll_votes', {
    filter: pollId ? { poll: { _eq: pollId } } : { id: { _eq: -1 } },
    // Expand the voter so managers can see per-member answers (non-anonymous
    // polls). Non-managers only ever receive their own vote row (poll_votes
    // read is OWN_MEMBER for them), so this leaks nothing. As of the 2026-07-02
    // audit (#5/#14) the manager reads are ALSO scoped to non-anonymous polls,
    // so for an anonymous poll this returns just the caller's own row.
    fields: ['id', 'poll', 'member', 'selected_options', 'member.id', 'member.first_name', 'member.last_name'],
    all: true,
    enabled: !!pollId,
  })
  const votes = votesRaw ?? []

  const { create, update } = useMutation<PollVote>('poll_votes')

  // Anonymous polls: raw vote rows are withheld from managers at the data layer
  // (anonymity is no longer a UI-only toggle). A manager instead pulls the
  // identity-free aggregate from GET /kscw/polls/:id/results. `tick` bumps on
  // realtime vote events so the tally stays live without exposing identities.
  const [tick, setTick] = useState(0)
  const [anonCounts, setAnonCounts] =
    useState<{ counts: Record<number, number>; totalVotes: number } | null>(null)
  useEffect(() => {
    // Only anonymous polls viewed by a manager need the counts endpoint. When it
    // doesn't apply we simply leave anonCounts untouched — getResults() gates on
    // `anonymous && canManage` so a stale value is never read (and avoiding a
    // synchronous setState here keeps the effect free of cascading renders).
    if (!pollId || !anonymous || !canManage) return
    let cancelled = false
    kscwApi<{ counts: Record<number, number>; totalVotes: number }>(`/polls/${pollId}/results`)
      .then((r) => { if (!cancelled) setAnonCounts({ counts: r.counts ?? {}, totalVotes: r.totalVotes ?? 0 }) })
      .catch(() => { if (!cancelled) setAnonCounts(null) })
    return () => { cancelled = true }
  }, [pollId, anonymous, canManage, tick])

  useRealtime<PollVote>('poll_votes', (e) => {
    if (e.record.poll === pollId) { refetch(); setTick((t) => t + 1) }
  })

  // `member` may arrive expanded (object) now, so compare via relId.
  const myVote = votes.find(v => relId(v.member) === user?.id)

  const vote = useCallback(async (selectedOptions: number[]) => {
    if (!user) return
    if (myVote) {
      await update(myVote.id, { selected_options: selectedOptions })
    } else {
      await create({
        poll: pollId,
        member: user.id,
        selected_options: selectedOptions,
      })
    }
    refetch()
  }, [user, pollId, myVote, create, update, refetch])

  // Compute results: count votes per option index, and (when the voter is
  // expanded) collect who picked each option so managers can see per-member
  // answers. For multi-choice a voter appears under every option they selected.
  // Memoized so PollCard re-renders don't recompute the tally unless the inputs
  // actually changed.
  const results = useMemo(() => {
    // Anonymous poll, manager view: return the identity-free endpoint counts.
    // No `voters` — that's the whole point of anonymity.
    if (anonymous && canManage && anonCounts) {
      return { counts: anonCounts.counts, voters: {} as Record<number, Array<{ id: string; name: string }>>, totalVotes: anonCounts.totalVotes }
    }
    const counts: Record<number, number> = {}
    const voters: Record<number, Array<{ id: string; name: string }>> = {}
    votes.forEach(v => {
      const m = v.member as unknown as string | { id: string | number; first_name?: string; last_name?: string }
      const id = relId(m)
      const name = (typeof m === 'object' && m ? memberName(m) : '') || id
      const selected = (v.selected_options as number[]) ?? []
      selected.forEach(idx => {
        counts[idx] = (counts[idx] || 0) + 1
        if (!voters[idx]) voters[idx] = []
        voters[idx].push({ id, name })
      })
    })
    return { counts, voters, totalVotes: votes.length }
  }, [anonymous, canManage, anonCounts, votes])

  const getResults = useCallback(() => results, [results])

  return { votes, myVote, isLoading, vote, getResults }
}
