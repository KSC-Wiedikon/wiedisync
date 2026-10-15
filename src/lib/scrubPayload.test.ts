// The key scrubber is what stands between a failed request's body and two sinks:
// Sentry (a third-party processor) and the 30-day JSONL error log. It knew only
// `password` exactly, so a failed /change-password shipped `current_password`,
// `new_password` and the re-wrapped E2EE key in full (security audit 2026-10, H2).
import { describe, it, expect } from 'vitest'
import { isPiiKey, scrubPayload } from './sentry'

describe('isPiiKey', () => {
  it('catches every password spelling, not just the exact key', () => {
    for (const k of ['password', 'current_password', 'new_password', 'newPassword', 'password_confirm',
      'passwd', 'pwd', 'new_pwd', 'PASSWORD']) {
      expect(isPiiKey(k), k).toBe(true)
    }
  })

  it('catches key material: private keys, salts, KDF params, anything e2ee', () => {
    for (const k of ['private_key', 'privateKey', 'e2ee_private_key', 'wrapped_key', 'salt', 'kdf_salt',
      'kdfSalt', 'kdf', 'e2ee', 'e2ee_kdf_salt', 'api_key', 'client_secret', 'session_cookie', 'authorization']) {
      expect(isPiiKey(k), k).toBe(true)
    }
  })

  it('catches tokens, tickets, OTPs, PINs and the bare OTP `code`', () => {
    for (const k of ['token', 'share_token', 'turnstile_token', 'ticket', 'upload_ticket', 'otp', 'otp_code',
      'pin', 'write_pin', 'writePin', 'PIN', 'code']) {
      expect(isPiiKey(k), k).toBe(true)
    }
  })

  it('catches the personal data ProfileEditForm sends', () => {
    for (const k of ['ahv_nummer', 'ahvNummer', 'iban', 'qr_iban', 'adresse', 'address', 'ip_address', 'strasse',
      'plz', 'ort', 'city', 'plz_ort', 'postcode', 'postal_code', 'zip', 'zip_code', 'birthdate', 'birth_date', 'dob',
      'phone', 'mobile_phone', 'email', 'proposer_email', 'first_name', 'last_name', 'firstName', 'contact_name']) {
      expect(isPiiKey(k), k).toBe(true)
    }
  })

  it('leaves ordinary keys alone — the boundary rules are what keep the log useful', () => {
    // `ort` inside "sort"/"report"/"export", `pin` inside "mapping"/"shipping"/"pinned",
    // `otp` inside "footprint", `code` as a suffix of a diagnostic.
    for (const k of ['sort', 'sort_order', 'sortBy', 'report', 'export', 'port', 'mapping', 'shipping', 'pinned',
      'is_pinned', 'spinner', 'footprint', 'error_code', 'status_code', 'codes', 'salted', 'kind', 'mime', 'size',
      'count', 'member', 'team_id', 'event_type', 'description', 'operation', 'recipients', 'missing']) {
      expect(isPiiKey(k), k).toBe(false)
    }
  })
})

describe('scrubPayload', () => {
  it('redacts the whole /change-password body, the e2ee object included', () => {
    const body = {
      current_password: 'OldPassw0rd!', // gitleaks:allow — synthetic fixture
      new_password: 'NewPassw0rd!', // gitleaks:allow — synthetic fixture
      e2ee: { private_key: 'wrapped-private-key-b64', salt: 'salt-b64' }, // gitleaks:allow — synthetic fixture
    }
    const out = JSON.stringify(scrubPayload(body))
    for (const secret of ['OldPassw0rd!', 'NewPassw0rd!', 'wrapped-private-key-b64', 'salt-b64']) {
      expect(out).not.toContain(secret)
    }
    expect(scrubPayload(body)).toEqual({
      current_password: '[REDACTED]',
      new_password: '[REDACTED]',
      e2ee: '[REDACTED]',
    })
  })

  it('redacts the /identity/keys body', () => {
    expect(scrubPayload({ public_key: 'pub', private_key: 'priv', salt: 's' }))
      .toEqual({ public_key: 'pub', private_key: '[REDACTED]', salt: '[REDACTED]' })
  })

  it('redacts a member update but keeps its non-personal fields', () => {
    expect(scrubPayload({ ahv_nummer: '756.1234.5678.97', adresse: 'Weg 1', plz: '8000', ort: 'Zürich', number: 7, sex: 'f' }))
      .toEqual({ ahv_nummer: '[REDACTED]', adresse: '[REDACTED]', plz: '[REDACTED]', ort: '[REDACTED]', number: 7, sex: 'f' })
  })

  it('descends into nested objects and arrays, including a top-level array', () => {
    expect(scrubPayload({ rows: [{ id: 1, email: 'a@b.ch', meta: { write_pin: '1234', sort: 'asc' } }] }))
      .toEqual({ rows: [{ id: 1, email: '[REDACTED]', meta: { write_pin: '[REDACTED]', sort: 'asc' } }] })
    expect(scrubPayload([{ password: 'x' }, { team: 3 }])).toEqual([{ password: '[REDACTED]' }, { team: 3 }])
  })

  it('passes primitives through', () => {
    expect(scrubPayload('text')).toBe('text')
    expect(scrubPayload(null)).toBeNull()
    expect(scrubPayload(3)).toBe(3)
  })
})
