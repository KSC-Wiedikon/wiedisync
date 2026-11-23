// @vitest-environment happy-dom
//
// Venue → Hall "Sync / Overwrite" (migration 455): an overwritten game says so and
// what the official source gives; switching back to Sync posts { override: false }
// and re-reads the game; saving what is already there is not offered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  halls: [
    { id: 1, name: 'KWI A' },
    { id: 2, name: 'KWI B' },
    { id: 3, name: 'KWI C' },
  ],
  kscwApi: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  invalidate: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}:${Object.values(o).join('|')}` : key),
    i18n: { language: 'en' },
  }),
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: h.row }) }))
vi.mock('../../../lib/query', () => ({
  useCollection: () => ({ data: h.halls }),
  invalidateForCollection: h.invalidate,
  keys: { collection: (n: string) => ['scope', n] },
}))
vi.mock('../../../lib/api', () => ({ fetchItem: vi.fn(), kscwApi: h.kscwApi }))
vi.mock('sonner', () => ({ toast: h.toast }))

import GameHallSource from './GameHallSource'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  h.kscwApi.mockReset()
  h.toast.success.mockReset()
  h.invalidate.mockReset()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined

async function render(onSaved = vi.fn()) {
  await act(async () => { root.render(<GameHallSource gameId={7} onSaved={onSaved} />) })
  return onSaved
}

describe('GameHallSource', () => {
  it('an overwritten game shows the chip, the official hall and who overwrote it', async () => {
    h.row = {
      id: 7, source: 'swiss_volley', type: 'home', hall: 3, additional_halls: null, hall_override: true,
      synced_hall: 1, synced_additional_halls: ['2'], hall_override_by_name: 'Ada Admin', hall_override_at: '2026-11-23T13:32:00Z',
    }
    await render()
    expect(container.textContent).toContain('hallSourceOverwritten')
    expect(container.textContent).toContain('hallSourceFromVm:KWI A + KWI B')
    expect(container.textContent).toContain('hallSourceOverwrittenBy:Ada Admin|23.11.2026 14:32')
  })

  it('back to Sync posts override: false, re-reads the game and says the calendar moved', async () => {
    h.row = {
      id: 7, source: 'basketplan', type: 'home', hall: 3, additional_halls: null, hall_override: true,
      synced_hall: 1, synced_additional_halls: null, hall_override_by_name: 'Ada Admin', hall_override_at: null,
    }
    h.kscwApi.mockResolvedValue({ calendar: { outcome: 'updated', dryRun: false } })
    const onSaved = await render()
    await act(async () => { button('hallSourceEdit')!.click() })
    // Opens on the current state: Overwrite, with the hall picker.
    expect(container.textContent).toContain('hallSourceOverrideHint:Basketplan')
    await act(async () => { button('hallSourceSync')!.click() })
    expect(container.textContent).toContain('hallSourceFromBasketplan:KWI A')
    await act(async () => { button('save')!.click() })
    expect(h.kscwApi).toHaveBeenCalledWith('/games/7/hall-source', { method: 'POST', body: { override: false } })
    expect(h.toast.success).toHaveBeenCalledWith('hallSourceSavedCalendar')
    expect(h.invalidate).toHaveBeenCalledWith('games')
    expect(onSaved).toHaveBeenCalled()
  })

  it('a game on Sync cannot "save" Sync again', async () => {
    h.row = {
      id: 7, source: 'swiss_volley', type: 'home', hall: 1, additional_halls: null, hall_override: false,
      synced_hall: 1, synced_additional_halls: null, hall_override_by_name: null, hall_override_at: null,
    }
    await render()
    expect(container.textContent).not.toContain('hallSourceOverwritten')
    await act(async () => { button('hallSourceEdit')!.click() })
    expect(button('save')!.disabled).toBe(true)
    await act(async () => { button('hallSourceOverride')!.click() })
    // Overwrite with no hall chosen yet: still nothing to save.
    expect(button('save')!.disabled).toBe(true)
  })

  it('a dev dry run says the calendar was not written', async () => {
    h.row = {
      id: 7, source: 'swiss_volley', type: 'home', hall: 3, additional_halls: null, hall_override: true,
      synced_hall: 1, synced_additional_halls: null, hall_override_by_name: null, hall_override_at: null,
    }
    h.kscwApi.mockResolvedValue({ calendar: { outcome: 'deleted', dryRun: true } })
    await render()
    await act(async () => { button('hallSourceEdit')!.click() })
    await act(async () => { button('hallSourceSync')!.click() })
    await act(async () => { button('save')!.click() })
    expect(h.toast.success).toHaveBeenCalledWith('hallSourceSavedDryRun')
  })
})
