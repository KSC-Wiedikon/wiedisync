// The error log is written from an UNAUTHENTICATED route onto a bind mount that
// shares a disk with Postgres, so its size bounds are a security control, not
// housekeeping (audit 2026-08-08, finding 11).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kscw-errlog-'))
  process.env.ERROR_LOG_DIR = dir
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.ERROR_LOG_DIR
})

// Imported lazily so ERROR_LOG_DIR is set before the module reads it.
async function fresh() {
  const mod = await import('../error-log.js?t=' + Math.random())
  return mod
}

const readAll = () =>
  readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean))

// fs.appendFile is async with a no-op callback, so give the write a tick.
const flush = () => new Promise((r) => setTimeout(r, 30))

describe('writeErrorLog size ceilings', () => {
  it('truncates an oversized line instead of writing it whole', async () => {
    const { writeErrorLog } = await fresh()
    writeErrorLog({ level: 'error', project: 'p', event: 'e', error: 'boom', userAgent: 'A'.repeat(1_000_000) })
    await flush()
    const lines = readAll()
    expect(lines).toHaveLength(1)
    expect(Buffer.byteLength(lines[0])).toBeLessThan(16 * 1024)
  })

  it('KEEPS the truncated entry rather than dropping it', async () => {
    // Dropping would let a caller erase their own trace by padding a field.
    const { writeErrorLog } = await fresh()
    writeErrorLog({ level: 'error', project: 'p', event: 'e', error: 'boom', payload: 'B'.repeat(200_000) })
    await flush()
    const e = JSON.parse(readAll()[0])
    expect(e.truncated).toBe(true)
    expect(e.error).toBe('boom')
    expect(e.original_bytes).toBeGreaterThan(16 * 1024)
  })

  it('writes a normal entry through untouched', async () => {
    const { writeErrorLog } = await fresh()
    writeErrorLog({ level: 'warn', project: 'wiedisync', event: 'client_error', error: 'ordinary' })
    await flush()
    const e = JSON.parse(readAll()[0])
    expect(e.truncated).toBeUndefined()
    expect(e.error).toBe('ordinary')
    expect(e.level).toBe('warn')
  })

  it('stops appending once a day-file is past the ceiling', async () => {
    const { writeErrorLog } = await fresh()
    const date = new Date().toISOString().slice(0, 10)
    writeFileSync(join(dir, `errors-${date}.jsonl`), 'x'.repeat(65 * 1024 * 1024))
    writeErrorLog({ level: 'error', project: 'p', event: 'e', error: 'should not be appended' })
    await flush()
    expect(readAll().some((l) => l.includes('should not be appended'))).toBe(false)
  })
})
