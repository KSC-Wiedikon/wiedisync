// The signups view lists every OpnForm submission, not just the first page of 100.
import { describe, it, expect, vi } from 'vitest'

const listSubmissions = vi.fn()
vi.mock('../opnform.js', () => ({
  badSlug: () => false,
  listSubmissions: (...a) => listSubmissions(...a),
  createFormFromTemplate: vi.fn(),
  findFreeSlug: vi.fn(),
  formUrl: vi.fn(),
}))
vi.mock('../activity-log.js', () => ({ writeUserLog: vi.fn(async () => {}) }))

const { listAllSubmissions } = await import('../event-signup-form.js')

describe('listAllSubmissions', () => {
  it('walks every page and keeps the form metadata', async () => {
    listSubmissions.mockReset()
    listSubmissions.mockImplementation(async (_slug, { page }) => ({
      title: 'Form', fields: [{ id: 'e' }], data: [{ id: page }], total: 3, page, per_page: 100, last_page: 3,
    }))
    const all = await listAllSubmissions('kurs')
    expect(all.data.map((r) => r.id)).toEqual([1, 2, 3])
    expect(all.fields).toEqual([{ id: 'e' }])
    expect(all.truncated).toBe(false)
  })

  it('stops at the page cap and says so', async () => {
    listSubmissions.mockReset()
    listSubmissions.mockImplementation(async (_slug, { page }) => ({ title: 'F', fields: [], data: [{ id: page }], last_page: 50 }))
    const all = await listAllSubmissions('big', 2)
    expect(all.data).toHaveLength(2)
    expect(all.truncated).toBe(true)
  })
})
