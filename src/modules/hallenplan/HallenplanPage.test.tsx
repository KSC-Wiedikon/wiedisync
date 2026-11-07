// @vitest-environment happy-dom
//
// The Hallenplan opens on the whole week on every screen size, and a single day is
// something you choose. A phone used to open on today alone. It can't fit the week grid
// (7 days of hall columns, about 18 px each), so there the week is the days stacked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => {
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 2 + i))
  return {
    mobile: false,
    weekDays,
    data: { halls: [] as unknown[], teams: [] as unknown[], slots: [] as unknown[], rawSlots: [] as unknown[], closures: [] as unknown[], isLoading: false, refetch: () => {} },
    week: { weekDays, goNext: () => {}, goPrev: () => {}, goToday: vi.fn(), weekLabel: 'KW 45', mondayStr: '2026-11-02', sundayStr: '2026-11-08' },
    i18n: { t: (key: string) => key, i18n: { language: 'en' } },
    auth: { coachTeamIds: [] as string[], hasAdminAccessToTeam: () => false, hasAdminAccessToSport: () => false },
    admin: { effectiveIsAdmin: true, effectiveIsCoach: false },
  }
})

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => h.i18n }))
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<object>()), useNavigate: () => () => {} }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => h.auth }))
vi.mock('../../hooks/useAdminMode', () => ({ useAdminMode: () => h.admin }))
vi.mock('../../hooks/useRealtime', () => ({ useRealtime: () => {} }))
vi.mock('../../hooks/useMediaQuery', async (orig) => ({ ...(await orig<object>()), useIsMobile: () => h.mobile }))
vi.mock('../../hooks/usePageReady', () => ({ useReportPageLoading: () => {} }))
vi.mock('./hooks/useWeekNavigation', () => ({ useWeekNavigation: () => h.week }))
vi.mock('./hooks/useHallenplanData', () => ({ useHallenplanData: () => h.data }))
vi.mock('../guide/GuideHelpButton', () => ({ GuideHelpButton: () => null }))
vi.mock('./components/WeekSlotView', () => ({ default: () => <div data-testid="week-grid" /> }))
vi.mock('./components/DaySlotView', () => ({
  default: ({ dayIndex }: { dayIndex: number }) => <div data-testid="day" data-day={dayIndex} />,
}))
vi.mock('./components/SummaryView', () => ({ default: () => null }))
vi.mock('./components/SlotEditor', () => ({ default: () => null }))
vi.mock('./components/VirtualSlotDetailModal', () => ({ default: () => null }))
vi.mock('./components/ClaimModal', () => ({ default: () => null }))
vi.mock('./components/ClaimDetailModal', () => ({ default: () => null }))

import HallenplanPage from './HallenplanPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const slotOn = (day: number) => ({ id: `s${day}`, day_of_week: day, hall: 'a', start_time: '18:00', end_time: '20:00', slot_type: 'training', team: [] })

describe('HallenplanPage', () => {
  let root: Root
  let host: HTMLElement

  const render = () => act(async () => { root.render(<HallenplanPage />) })
  const dayButtons = () => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="filterByDay"] button')]
  const pressedDays = () => dayButtons().filter((b) => b.getAttribute('aria-pressed') === 'true').length
  const clickDay = (i: number) => act(async () => { dayButtons()[i].click() })
  const buttonNamed = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)
  const daysShown = () => [...host.querySelectorAll('[data-testid="day"]')].map((d) => Number(d.getAttribute('data-day')))
  const hasWeekGrid = () => host.querySelector('[data-testid="week-grid"]') !== null

  beforeEach(() => {
    h.mobile = false
    h.data = { ...h.data, slots: [slotOn(0), slotOn(5)], closures: [] }
    h.week.goToday.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  describe.each([
    ['desktop', false],
    ['phone', true],
  ])('on a %s', (_name, mobile) => {
    beforeEach(() => { h.mobile = mobile })

    it('opens on the whole week, with no day chosen', async () => {
      await render()
      expect(dayButtons()).toHaveLength(7)
      expect(pressedDays()).toBe(0)
      expect(host.textContent).toContain('subtitleWeek')
      expect(buttonNamed('wholeWeek')).toBeUndefined()
    })

    it('narrows to one day, and the same day again goes back', async () => {
      await render()
      await clickDay(3)
      expect(daysShown()).toEqual([3])
      expect(hasWeekGrid()).toBe(false)
      expect(pressedDays()).toBe(1)
      expect(host.textContent).toContain('subtitleDay')

      await clickDay(3)
      expect(pressedDays()).toBe(0)
      expect(host.textContent).toContain('subtitleWeek')
    })

    it('goes back with "Whole week" too', async () => {
      await render()
      await clickDay(1)
      await act(async () => { buttonNamed('wholeWeek')!.click() })
      expect(pressedDays()).toBe(0)
    })

    it('stays on the week when Today is pressed, and moves a chosen day to today', async () => {
      await render()
      await act(async () => { buttonNamed('today')!.click() })
      expect(h.week.goToday).toHaveBeenCalledTimes(1)
      expect(pressedDays()).toBe(0)

      await clickDay(1)
      await act(async () => { buttonNamed('today')!.click() })
      expect(pressedDays()).toBe(1)
    })
  })

  it('shows the week grid on a desktop', async () => {
    await render()
    expect(hasWeekGrid()).toBe(true)
    expect(daysShown()).toEqual([])
  })

  it('stacks the days in use on a phone, instead of the grid', async () => {
    h.mobile = true
    await render()
    expect(hasWeekGrid()).toBe(false)
    expect(daysShown()).toEqual([0, 5])
  })

  it('counts a closed hall as a day in use on a phone', async () => {
    h.mobile = true
    h.data = { ...h.data, slots: [], closures: [{ id: 'c', hall: 'a', start_date: '2026-11-04', end_date: '2026-11-04' }] }
    await render()
    expect(daysShown()).toEqual([2])
  })

  it('says so on a phone when the week is empty', async () => {
    h.mobile = true
    h.data = { ...h.data, slots: [] }
    await render()
    expect(daysShown()).toEqual([])
    expect(host.textContent).toContain('emptyWeek')
  })
})
