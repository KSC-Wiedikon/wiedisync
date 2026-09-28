/**
 * bugfixErrorInfo — reads the structured refusals of /kscw/bugfixes (audit
 * 2026-09-28 F35): 422 suspicious_content (+ signals) on /fix, 422
 * protected_paths (+ files) / pr_too_large on /deploy. kscwApi attaches the
 * parsed body as `err.body` and its `code` as `err.code`.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/api', () => ({ kscwApi: vi.fn() }))

import { bugfixErrorInfo, deployFixBody } from './useBugfixes'

function apiError(status: number, body: Record<string, unknown>) {
  const err = new Error(`API /bugfixes: ${status}`) as Error & { code?: string; body?: unknown; status?: number }
  err.status = status
  err.body = body
  if (typeof body.code === 'string') err.code = body.code
  return err
}

describe('bugfixErrorInfo', () => {
  it('reads suspicious_content signals', () => {
    const info = bugfixErrorInfo(apiError(422, { error: 'looks like instructions', code: 'suspicious_content', signals: ['role_play', 'shell'] }))
    expect(info.code).toBe('suspicious_content')
    expect(info.signals).toEqual(['role_play', 'shell'])
    expect(info.message).toBe('looks like instructions')
  })

  it('reads protected_paths files', () => {
    const info = bugfixErrorInfo(apiError(422, { error: 'protected', code: 'protected_paths', files: ['.github/workflows/x.yml'] }))
    expect(info.code).toBe('protected_paths')
    expect(info.files).toEqual(['.github/workflows/x.yml'])
  })

  it('ignores non-string list entries', () => {
    const info = bugfixErrorInfo(apiError(422, { code: 'suspicious_content', signals: ['a', 1, null] }))
    expect(info.signals).toEqual(['a'])
  })

  it('falls back to the raw error for an unstructured failure', () => {
    const info = bugfixErrorInfo(new Error('network down'))
    expect(info.code).toBeNull()
    expect(info.message).toBe('Error: network down')
    expect(info.signals).toEqual([])
    expect(info.files).toEqual([])
  })
})

describe('deployFixBody', () => {
  it('always carries the review acknowledgement the endpoint requires', () => {
    expect(deployFixBody('dev')).toEqual({ target: 'dev', reviewed: true })
    expect(deployFixBody('prod')).toEqual({ target: 'prod', reviewed: true })
  })

  it('reads a 422 review_required refusal', () => {
    const info = bugfixErrorInfo(apiError(422, { error: 'Confirm you reviewed the PR diff', code: 'review_required' }))
    expect(info.code).toBe('review_required')
  })
})
