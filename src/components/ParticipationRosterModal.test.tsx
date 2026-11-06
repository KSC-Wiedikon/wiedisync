// @vitest-environment happy-dom
//
// The participation modal when a request fails: it says so and offers Retry. It
// used to count the empty lists instead, so a team of 21 with 18 answers read
// "0 No response, No responses yet" (roster failed) or as nobody having answered
// (answers failed). A team that really has nobody on it keeps the empty state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => {
  const refetch = () => vi.fn(async () => {})
  return {
    refetch,
    members: {} as Record<string, unknown>,
    answers: {} as Record<string, unknown>,
    clubWide: {} as Record<string, unknown>,
    // Everything below is stable, like the real hooks' results: the modal keys
    // render-phase state and effects on these identities.
    emptyQuery: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
    noAnswers: { participations: [] as unknown[], isLoading: false, loadFailed: false, refetch: vi.fn() },
    i18n: {
      t: (key: string) => key,
      i18n: { language: 'en', getFixedT: () => (key: string) => key },
    },
    auth: { user: { id: 'viewer' }, teamResponsibleIds: [] as string[] },
    permissions: { canManageTeam: () => false },
    adminMode: { effectiveIsAdmin: false },
    mutation: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    fineRules: { data: [] as unknown[] },
    fetchAllItems: vi.fn(),
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => h.i18n,
}))
vi.mock('@/components/Modal', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}))
vi.mock('../modules/fines/IssueFineModal', () => ({ default: () => null }))
vi.mock('../hooks/useTeamMembers', () => ({ useMultiTeamMembers: () => h.members }))
vi.mock('../hooks/useParticipation', () => ({
  useTeamParticipations: () => h.answers,
  useAllEventParticipations: () => h.noAnswers,
}))
vi.mock('../hooks/useFines', () => ({ pickFineRule: () => null, useFineRules: () => h.fineRules }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => h.auth }))
vi.mock('../hooks/useTeamPermissions', () => ({ useTeamPermissions: () => h.permissions }))
vi.mock('../hooks/useAdminMode', () => ({ useAdminMode: () => h.adminMode }))
vi.mock('../hooks/useMutation', () => ({ useMutation: () => h.mutation }))
// Only the club-wide participations query is enabled-and-answering in these cases;
// every other collection the modal reads comes back empty.
vi.mock('../lib/query', () => ({
  useCollection: (collection: string, options?: { enabled?: boolean; filter?: unknown }) => {
    const isClubWideParts = collection === 'participations' && options?.enabled === true
      && JSON.stringify(options?.filter ?? {}).includes('activity_type')
      && !JSON.stringify(options?.filter ?? {}).includes('member')
    return isClubWideParts ? h.clubWide : h.emptyQuery
  },
}))
vi.mock('../lib/api', () => ({ fetchAllItems: h.fetchAllItems }))

import ParticipationRosterModal from './ParticipationRosterModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const person = { id: 'p1', first_name: 'Fake', last_name: 'Player' }
const rosterRow = { id: 'mt1', member: person, team: '92', guest_level: 0 }
const answer = { id: 'a1', member: 'p1', activity_type: 'training', activity_id: '3971', status: 'confirmed', is_staff: false, guest_count: 0 }

describe('ParticipationRosterModal when a request fails', () => {
  let root: Root
  let host: HTMLElement

  const renderModal = (teamIds: string[]) => act(async () => {
    root.render(
      <ParticipationRosterModal
        open
        onClose={() => {}}
        activityType={teamIds.length ? 'training' : 'event'}
        activityId="3971"
        activityDate="2026-11-07"
        teamIds={teamIds}
        title="H3 — 07.11.2026"
      />,
    )
  })
  const alert = () => host.querySelector('[role="alert"]')
  const clickRetry = () => act(async () => {
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('retry'))
    button!.click()
  })

  beforeEach(() => {
    h.members = { members: [rosterRow], teamsByMember: new Map(), isLoading: false, error: null, refetch: h.refetch() }
    h.answers = { participations: [answer], isLoading: false, loadFailed: false, refetch: h.refetch() }
    h.clubWide = { data: [answer], isLoading: false, isError: false, refetch: h.refetch() }
    h.fetchAllItems.mockReset()
    // The people of a club-wide event; absences and the rest stay empty.
    h.fetchAllItems.mockImplementation(async (collection: string) => (collection === 'members' ? [person] : []))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('shows the roster and its counts when everything loaded', async () => {
    await renderModal(['92'])
    expect(alert()).toBeNull()
    expect(host.textContent).toContain('1 confirmed')
    expect(host.textContent).not.toContain('noResponses')
  })

  it('still shows the empty state for a team that really has nobody on it', async () => {
    h.members = { ...h.members, members: [] }
    h.answers = { ...h.answers, participations: [] }
    await renderModal(['92'])
    expect(alert()).toBeNull()
    expect(host.textContent).toContain('noResponses')
  })

  it('keeps a loaded roster when an older request fails late', async () => {
    h.members = { ...h.members, members: [rosterRow], error: new Error('Service Unavailable') }
    await renderModal(['92'])
    expect(alert()).toBeNull()
    expect(host.textContent).toContain('1 confirmed')
  })

  it('says the roster failed instead of counting zeros, and retries it', async () => {
    h.members = { ...h.members, members: [], error: new Error('Service Unavailable') }
    h.answers = { ...h.answers, participations: [] }
    await renderModal(['92'])

    expect(alert()?.textContent).toContain('rosterLoadFailed')
    expect(host.textContent).not.toContain('noResponses')
    expect(host.textContent).not.toContain('notResponded')

    await clickRetry()
    expect(h.members.refetch).toHaveBeenCalledTimes(1)
    expect(h.answers.refetch).not.toHaveBeenCalled()
  })

  it('says the answers failed instead of listing everyone as not answered, and retries them', async () => {
    h.answers = { ...h.answers, participations: [], loadFailed: true }
    await renderModal(['92'])

    expect(alert()?.textContent).toContain('rosterLoadFailed')
    expect(host.textContent).not.toContain('notResponded')

    await clickRetry()
    expect(h.answers.refetch).toHaveBeenCalledTimes(1)
    expect(h.members.refetch).not.toHaveBeenCalled()
  })

  it('covers a club-wide event whose answers failed', async () => {
    h.clubWide = { ...h.clubWide, data: undefined, isError: true }
    await renderModal([])

    expect(alert()?.textContent).toContain('rosterLoadFailed')
    await clickRetry()
    expect(h.clubWide.refetch).toHaveBeenCalledTimes(1)
  })

  it('covers a club-wide event whose people failed, and fetches them again on retry', async () => {
    let failures = 1
    h.fetchAllItems.mockImplementation(async (collection: string) => {
      if (collection !== 'members') return []
      if (failures-- > 0) throw new Error('Service Unavailable')
      return [person]
    })
    await renderModal([])
    expect(alert()?.textContent).toContain('rosterLoadFailed')

    await clickRetry()
    expect(alert()).toBeNull()
    expect(failures).toBeLessThan(0)
    expect(host.textContent).toContain('1 confirmed')
  })

  it('keeps a good list on screen when only a background refresh fails', async () => {
    // `data` is still there, so useCollection's isError alone must not take the list away.
    h.clubWide = { ...h.clubWide, data: [answer], isError: true }
    await renderModal([])
    expect(alert()).toBeNull()
    expect(host.textContent).toContain('1 confirmed')
  })
})
