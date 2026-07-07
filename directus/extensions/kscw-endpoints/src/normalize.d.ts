// Type surface for normalize.js — lets the frontend parity test
// (src/utils/__tests__/contact-normalize-parity.test.ts) import the backend
// module type-safely. Keep in sync with normalize.js exports.
export interface NormalizeResult {
  ok: boolean
  value: string | null
  reason?: 'unparseable' | 'bad_length' | 'format' | 'checksum' | 'excel_mangled'
}
export function normalizePhone(raw: unknown): NormalizeResult
export function normalizeIban(raw: unknown): NormalizeResult
export function normalizeAhv(raw: unknown): NormalizeResult
export function normalizeEmail(raw: unknown): NormalizeResult
